import { spawn } from "node:child_process";

import semver from "semver";

import { canonicalVulnerabilityId } from "@/lib/scanner/ids";
import { mapSeverity, numericScore } from "@/lib/scanner/severity";
import type { DraftFinding, InstalledPackage, ScanError } from "@/lib/scanner/types";

const AUDIT_TIMEOUT_MS = 60_000;

type AuditVia = {
  source?: unknown;
  name?: unknown;
  title?: unknown;
  url?: unknown;
  severity?: unknown;
  cvss?: { score?: unknown };
  range?: unknown;
};

type AuditVulnerability = {
  name?: unknown;
  severity?: unknown;
  via?: unknown;
  fixAvailable?: unknown;
};

export type AuditCollection = {
  findings: DraftFinding[];
  errors: ScanError[];
};

export async function collectNpmFindings(
  directory: string,
  packages: InstalledPackage[],
): Promise<AuditCollection> {
  const run = await runNpmAudit(directory);
  if (run.timedOut) {
    return { findings: [], errors: [{ source: "npm-audit", message: "npm audit timed out." }] };
  }
  if (run.spawnError) {
    return {
      findings: [],
      errors: [{ source: "npm-audit", message: `npm audit could not be started: ${truncate(run.spawnError)}` }],
    };
  }

  const parsed = parseAuditJson(run.stdout);
  if (!parsed.ok) {
    const detail = run.stderr.trim() ? ` ${truncate(run.stderr.trim())}` : "";
    return {
      findings: [],
      errors: [{ source: "npm-audit", message: `npm audit did not return JSON.${detail}` }],
    };
  }

  const report = parsed.value;
  if (isRecord(report.error) && !isRecord(report.vulnerabilities)) {
    const summary =
      stringValue(report.error.summary) ??
      stringValue(report.error.message) ??
      stringValue(report.error.detail) ??
      "npm audit failed.";
    return { findings: [], errors: [{ source: "npm-audit", message: truncate(summary) }] };
  }

  return findingsFromReport(report, packages);
}

function findingsFromReport(report: Record<string, unknown>, packages: InstalledPackage[]): AuditCollection {
  const vulnerabilities = isRecord(report.vulnerabilities) ? report.vulnerabilities : {};
  const findings: DraftFinding[] = [];
  const missingVersions: string[] = [];

  for (const [packageName, value] of Object.entries(vulnerabilities)) {
    if (!isRecord(value)) continue;
    const vuln = value as AuditVulnerability;
    const name = stringValue(vuln.name) ?? packageName;
    const versions = packages.filter((pkg) => pkg.name === name).map((pkg) => pkg.version);
    if (versions.length === 0) {
      missingVersions.push(name);
      continue;
    }

    const packageFix = fixedVersionFromFixAvailable(vuln.fixAvailable);
    for (const via of advisoryObjects(vuln.via)) {
      const identity = vulnerabilityIdentity(via);
      if (!identity) continue;
      const severity = mapSeverity(via.severity ?? vuln.severity);
      const cvssScore = numericScore(isRecord(via.cvss) ? via.cvss.score : undefined);
      const fixedVersion = fixedVersionFromRange(via.range);
      for (const installedVersion of versions) {
        if (!versionMatchesRange(installedVersion, stringValue(via.range))) continue;
        const finding: DraftFinding = {
          packageName: name,
          installedVersion,
          vulnerabilityId: identity.id,
          severity,
          source: "npm-audit",
          aliases: identity.aliases,
        };
        if (cvssScore !== undefined) finding.cvssScore = cvssScore;
        if (fixedVersion) finding.fixedVersion = fixedVersion;
        else if (packageFix) finding.fallbackFixedVersion = packageFix;
        findings.push(finding);
      }
    }
  }

  const errors: ScanError[] = [];
  if (missingVersions.length > 0) {
    errors.push({
      source: "npm-audit",
      message: `npm audit reported vulnerabilities for packages with no installed version on disk: ${missingVersions.join(", ")}.`,
    });
  }
  return { findings, errors };
}

function advisoryObjects(via: unknown): AuditVia[] {
  if (!Array.isArray(via)) return [];
  return via.filter(isRecord) as AuditVia[];
}

function vulnerabilityIdentity(via: AuditVia): { id: string; aliases: string[] } | null {
  const url = stringValue(via.url) ?? "";
  const title = stringValue(via.title) ?? "";
  const text = `${url} ${title}`;
  const ghsa = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(text)?.[0];
  const cve = /CVE-\d{4}-\d{4,}/i.exec(text)?.[0];
  const aliases: string[] = [];
  if (ghsa && cve) aliases.push(canonicalVulnerabilityId(cve));
  if (ghsa) return { id: canonicalVulnerabilityId(ghsa), aliases };
  if (cve) return { id: canonicalVulnerabilityId(cve), aliases };
  if (typeof via.source === "number" && Number.isFinite(via.source)) {
    return { id: `npm:${via.source}`, aliases };
  }
  if (typeof via.source === "string" && via.source.trim()) {
    return { id: `npm:${via.source.trim()}`, aliases };
  }
  return null;
}

function fixedVersionFromRange(range: unknown): string | undefined {
  const text = stringValue(range);
  if (!text) return undefined;
  let fixed: string | undefined;
  for (const part of text.split(/\s+/)) {
    if (part.startsWith("<") && !part.startsWith("<=")) {
      const version = part.slice(1);
      if (version) fixed = version;
    }
  }
  return fixed;
}

function fixedVersionFromFixAvailable(fixAvailable: unknown): string | undefined {
  if (!isRecord(fixAvailable)) return undefined;
  return stringValue(fixAvailable.version);
}

function versionMatchesRange(version: string, range: string | undefined): boolean {
  if (!range) return true;
  try {
    if (!semver.valid(version)) return true;
    return semver.satisfies(version, range, { includePrerelease: true });
  } catch {
    return true;
  }
}

function runNpmAudit(cwd: string): Promise<{
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { stdout: string; stderr: string; timedOut: boolean; spawnError?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // The directory is the child process cwd. It is never interpolated into a shell command.
    const child = spawn("npm", ["audit", "--json"], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, AUDIT_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ stdout, stderr, timedOut, spawnError: error.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish({ stdout, stderr, timedOut });
    });
  });
}

function parseAuditJson(
  stdout: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  const trimmed = stdout.trim();
  if (!trimmed) return { ok: false };
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (isRecord(value)) return { ok: true, value };
    } catch {
      continue;
    }
  }
  return { ok: false };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
