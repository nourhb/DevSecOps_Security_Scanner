import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { buildRemediations, type RemediationRecord, type Repository, type ScanRecord } from "@/lib/domain";
import { sameGitHubRepo } from "@/lib/github/parse-url";
import type { Finding, FindingSource, Severity } from "@/lib/scanner/types";
import { disconnectPrisma, getPrisma } from "@/lib/store/client";

const scanInclude = {
  findings: { orderBy: { position: "asc" as const } },
  remediations: { orderBy: { position: "asc" as const } },
} satisfies Prisma.ScanInclude;

type ScanRow = Prisma.ScanGetPayload<{ include: typeof scanInclude }>;

export type ScanStore = {
  listRepositories(): Promise<Repository[]>;
  listScans(): Promise<ScanRecord[]>;
  getRepository(id: string): Promise<Repository | undefined>;
  getScan(id: string): Promise<ScanRecord | undefined>;
  insertRepository(repository: Repository): Promise<Repository>;
  saveGitHubRepository(repository: Repository): Promise<Repository>;
  saveFixtureRepository(repository: Repository): Promise<Repository>;
  insertScanIfIdle(scan: ScanRecord): Promise<ScanRecord | null>;
  updateScan(
    id: string,
    patch: Partial<Omit<ScanRecord, "id" | "repositoryId" | "createdAt">>,
  ): Promise<ScanRecord | undefined>;
};

export function getStore(): ScanStore {
  return store;
}

export async function resetStore(): Promise<void> {
  const prisma = getPrisma();
  await prisma.remediation.deleteMany();
  await prisma.vulnerabilityFinding.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.repository.deleteMany();
}

export async function disconnectStore(): Promise<void> {
  await disconnectPrisma();
}

const store: ScanStore = {
  async listRepositories() {
    const rows = await getPrisma().repository.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toRepository);
  },
  async listScans() {
    const rows = await getPrisma().scan.findMany({ include: scanInclude, orderBy: { createdAt: "desc" } });
    return rows.map(toScan);
  },
  async getRepository(id) {
    const row = await getPrisma().repository.findUnique({ where: { id } });
    return row ? toRepository(row) : undefined;
  },
  async getScan(id) {
    const row = await getPrisma().scan.findUnique({ where: { id }, include: scanInclude });
    return row ? toScan(row) : undefined;
  },
  async insertRepository(repository) {
    const row = await getPrisma().repository.create({ data: repositoryData(repository) });
    return toRepository(row);
  },
  async saveGitHubRepository(repository) {
    return getPrisma().$transaction(async (tx) => {
      const rows = await tx.repository.findMany({ where: { kind: "github" } });
      const existing = rows.find((item) => sameGitHubRepo(item, repository));
      if (existing) return toRepository(existing);
      const created = await tx.repository.create({ data: repositoryData(repository) });
      return toRepository(created);
    });
  },
  async saveFixtureRepository(repository) {
    return getPrisma().$transaction(async (tx) => {
      const existing = await tx.repository.findFirst({
        where: { kind: "fixture", name: repository.name },
      });
      if (existing) return toRepository(existing);
      const created = await tx.repository.create({ data: repositoryData(repository) });
      return toRepository(created);
    });
  },
  async insertScanIfIdle(scan) {
    return getPrisma().$transaction(async (tx) => {
      const busy = await tx.scan.findFirst({
        where: { repositoryId: scan.repositoryId, status: { in: ["pending", "running"] } },
      });
      if (busy) return null;
      const created = await tx.scan.create({ data: scanData(scan), include: scanInclude });
      return toScan(created);
    });
  },
  async updateScan(id, patch) {
    return getPrisma().$transaction(async (tx) => {
      const existing = await tx.scan.findUnique({ where: { id } });
      if (!existing) return undefined;
      await tx.scan.update({ where: { id }, data: scanPatch(patch) });
      if (patch.findings) {
        await tx.vulnerabilityFinding.deleteMany({ where: { scanId: id } });
        await tx.remediation.deleteMany({ where: { scanId: id } });
        if (patch.findings.length > 0) {
          await tx.vulnerabilityFinding.createMany({ data: findingRows(id, patch.findings) });
          await tx.remediation.createMany({ data: remediationRows(id, buildRemediations(patch.findings)) });
        }
      }
      const row = await tx.scan.findUniqueOrThrow({ where: { id }, include: scanInclude });
      return toScan(row);
    });
  },
};

function repositoryData(repository: Repository): Prisma.RepositoryCreateInput {
  return {
    id: repository.id,
    kind: repository.kind,
    owner: repository.owner,
    name: repository.name,
    url: repository.url,
    createdAt: new Date(repository.createdAt),
  };
}

function scanData(scan: ScanRecord): Prisma.ScanCreateInput {
  return {
    id: scan.id,
    repository: { connect: { id: scan.repositoryId } },
    status: scan.status,
    runner: scan.runner ?? "local",
    createdAt: new Date(scan.createdAt),
    startedAt: scan.startedAt ? new Date(scan.startedAt) : null,
    finishedAt: scan.finishedAt ? new Date(scan.finishedAt) : null,
    error: scan.error,
    warnings: scan.warnings,
  };
}

function scanPatch(patch: Partial<Omit<ScanRecord, "id" | "repositoryId" | "createdAt">>): Prisma.ScanUpdateInput {
  const data: Prisma.ScanUpdateInput = {};
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.runner !== undefined) data.runner = patch.runner;
  if (patch.startedAt !== undefined) data.startedAt = patch.startedAt ? new Date(patch.startedAt) : null;
  if (patch.finishedAt !== undefined) data.finishedAt = patch.finishedAt ? new Date(patch.finishedAt) : null;
  if (patch.error !== undefined) data.error = patch.error;
  if (patch.warnings !== undefined) data.warnings = patch.warnings;
  return data;
}

function findingRows(scanId: string, findings: Finding[]): Prisma.VulnerabilityFindingCreateManyInput[] {
  return findings.map((finding, position) => ({
    id: randomUUID(),
    scanId,
    position,
    packageName: finding.packageName,
    installedVersion: finding.installedVersion,
    vulnerabilityId: finding.vulnerabilityId,
    severity: finding.severity,
    cvssScore: finding.cvssScore ?? null,
    fixedVersion: finding.fixedVersion ?? null,
    source: finding.source,
  }));
}

function remediationRows(scanId: string, rows: RemediationRecord[]): Prisma.RemediationCreateManyInput[] {
  return rows.map((row, position) => ({
    id: randomUUID(),
    scanId,
    position,
    packageName: row.packageName,
    installedVersion: row.installedVersion,
    vulnerabilityId: row.vulnerabilityId,
    fixedVersion: row.fixedVersion,
    advice: row.advice,
  }));
}

function toRepository(row: { id: string; kind: string; owner: string; name: string; url: string; createdAt: Date }): Repository {
  return {
    id: row.id,
    kind: row.kind === "fixture" ? "fixture" : "github",
    owner: row.owner,
    name: row.name,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
  };
}

function toScan(row: ScanRow): ScanRecord {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    status: toStatus(row.status),
    runner: row.runner === "actions" ? "actions" : "local",
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    error: row.error,
    warnings: row.warnings,
    findings: row.findings.map(toFinding),
    remediations: row.remediations.map((item) => ({
      packageName: item.packageName,
      installedVersion: item.installedVersion,
      vulnerabilityId: item.vulnerabilityId,
      fixedVersion: item.fixedVersion,
      advice: item.advice,
    })),
  };
}

function toFinding(row: ScanRow["findings"][number]): Finding {
  const finding: Finding = {
    packageName: row.packageName,
    installedVersion: row.installedVersion,
    vulnerabilityId: row.vulnerabilityId,
    severity: toSeverity(row.severity),
    source: toSource(row.source),
  };
  if (row.cvssScore !== null) finding.cvssScore = row.cvssScore;
  if (row.fixedVersion) finding.fixedVersion = row.fixedVersion;
  return finding;
}

function toStatus(value: string): ScanRecord["status"] {
  if (value === "pending" || value === "running" || value === "completed" || value === "failed") return value;
  return "failed";
}

function toSeverity(value: string): Severity {
  if (value === "CRITICAL" || value === "HIGH" || value === "MEDIUM" || value === "LOW" || value === "UNKNOWN") return value;
  return "UNKNOWN";
}

function toSource(value: string): FindingSource {
  return value === "osv" ? "osv" : "npm-audit";
}
