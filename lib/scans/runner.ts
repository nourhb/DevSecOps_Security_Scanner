import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Repository, ScanRecord } from "@/lib/domain";
import { scannerWarnings } from "@/lib/domain";
import { fetchGitHubManifests } from "@/lib/github/fetch-manifests";
import { parseGitHubRepoUrl, sameGitHubRepo } from "@/lib/github/parse-url";
import { scanDirectory } from "@/lib/scanner";
import { getStore } from "@/lib/store/json-store";

const FIXTURE_NAMES = ["clean", "vulnerable"] as const;
type FixtureName = (typeof FIXTURE_NAMES)[number];

type JobGlobal = { active?: Set<string> };

function activeJobs(): Set<string> {
  const root = globalThis as typeof globalThis & { __securerepoJobs?: JobGlobal };
  root.__securerepoJobs ??= {};
  root.__securerepoJobs.active ??= new Set();
  return root.__securerepoJobs.active;
}

export async function addGitHubRepository(
  url: string,
): Promise<{ ok: true; repository: Repository } | { ok: false; error: string; status: number }> {
  const parsed = parseGitHubRepoUrl(url);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const repository: Repository = {
    id: randomUUID(),
    kind: "github",
    owner: parsed.repo.owner,
    name: parsed.repo.name,
    url: parsed.repo.url,
    createdAt: new Date().toISOString(),
  };

  const saved = await getStore().transaction((data) => {
    const existing = data.repositories.find(
      (item) => item.kind === "github" && sameGitHubRepo(item, repository),
    );
    if (existing) return existing;
    data.repositories.push(repository);
    return repository;
  });

  if (saved.id !== repository.id) {
    return { ok: false, error: "That repository is already saved.", status: 409 };
  }
  return { ok: true, repository };
}

export async function startRepositoryScan(
  repositoryId: string,
): Promise<{ ok: true; scan: ScanRecord } | { ok: false; error: string; status: number }> {
  const repository = await getStore().getRepository(repositoryId);
  if (!repository) return { ok: false, error: "That repository is not saved.", status: 404 };
  return enqueue(repository);
}

export async function startFixtureScan(
  name: string,
): Promise<{ ok: true; scan: ScanRecord } | { ok: false; error: string; status: number }> {
  if (!isFixtureName(name)) {
    return { ok: false, error: "Choose the clean or vulnerable fixture.", status: 400 };
  }
  const repository = await ensureFixture(name);
  return enqueue(repository);
}

export async function reconcileOrphans(): Promise<void> {
  const active = activeJobs();
  const now = Date.now();
  const scans = await getStore().listScans();
  for (const scan of scans) {
    if (scan.status !== "pending" && scan.status !== "running") continue;
    if (active.has(scan.id)) continue;
    const created = new Date(scan.createdAt).getTime();
    if (Number.isNaN(created) || now - created < 1500) continue;
    await getStore().updateScan(scan.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "This scan stopped before it finished. Start it again.",
    });
  }
}

async function ensureFixture(name: FixtureName): Promise<Repository> {
  const created: Repository = {
    id: randomUUID(),
    kind: "fixture",
    owner: "local",
    name,
    url: "",
    createdAt: new Date().toISOString(),
  };
  return getStore().transaction((data) => {
    const existing = data.repositories.find((repository) => repository.kind === "fixture" && repository.name === name);
    if (existing) return existing;
    data.repositories.push(created);
    return created;
  });
}

async function enqueue(
  repository: Repository,
): Promise<{ ok: true; scan: ScanRecord } | { ok: false; error: string; status: number }> {
  await reconcileOrphans();
  const scan: ScanRecord = {
    id: randomUUID(),
    repositoryId: repository.id,
    status: "pending",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    warnings: [],
    findings: [],
  };

  const result = await getStore().transaction((data) => {
    const busy = data.scans.some(
      (item) =>
        item.repositoryId === repository.id && (item.status === "pending" || item.status === "running"),
    );
    if (busy) return null;
    data.scans.push(scan);
    return scan;
  });

  if (!result) {
    return { ok: false, error: "A scan is already running for this repository.", status: 409 };
  }

  activeJobs().add(scan.id);
  setTimeout(() => {
    void execute(scan.id, repository).finally(() => activeJobs().delete(scan.id));
  }, scanDelayMs());
  return { ok: true, scan };
}

async function execute(scanId: string, repository: Repository): Promise<void> {
  const store = getStore();
  await store.updateScan(scanId, { status: "running", startedAt: new Date().toISOString() });
  let tempDir: string | null = null;
  try {
    const directory = await materialize(repository);
    tempDir = directory.tempDir;
    const result = await scanDirectory(directory.scanDir);
    const warnings = scannerWarnings(result.errors);
    if (result.findings.length === 0 && warnings.length > 0) {
      await store.updateScan(scanId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: warnings.join(" "),
        warnings,
        findings: [],
      });
      return;
    }
    await store.updateScan(scanId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      error: null,
      warnings,
      findings: result.findings,
    });
  } catch (error) {
    await store.updateScan(scanId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error && error.message ? error.message : "The scan failed.",
      findings: [],
    });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

async function materialize(repository: Repository): Promise<{ scanDir: string; tempDir: string | null }> {
  if (repository.kind === "fixture") {
    if (!isFixtureName(repository.name)) throw new Error("The fixture is not available.");
    return { scanDir: path.join(process.cwd(), "fixtures", repository.name), tempDir: null };
  }

  const manifests = await fetchGitHubManifests(repository.owner, repository.name);
  if (!manifests.ok) throw new Error(manifests.message);

  const tempDir = await mkdtemp(path.join(tmpdir(), "securerepo-"));
  await writeFile(path.join(tempDir, "package.json"), manifests.files.packageJson);
  if (manifests.files.packageLock !== null) {
    await writeFile(path.join(tempDir, "package-lock.json"), manifests.files.packageLock);
  }
  return { scanDir: tempDir, tempDir };
}

function scanDelayMs(): number {
  const raw = process.env.SECUREREPO_SCAN_DELAY_MS;
  if (raw === undefined) return 400;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 400;
}

function isFixtureName(value: string): value is FixtureName {
  return FIXTURE_NAMES.some((name) => name === value);
}
