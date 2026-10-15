import semver from "semver";

import { canonicalVulnerabilityId } from "@/lib/scanner/ids";
import { mapSeverity, numericScore } from "@/lib/scanner/severity";
import type { DraftFinding, FetchLike, InstalledPackage, ScanError } from "@/lib/scanner/types";

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";
const OSV_CONCURRENCY = 5;
const OSV_TIMEOUT_MS = 20_000;

type OsvEvent = {
  introduced?: unknown;
  fixed?: unknown;
};

type OsvRange = {
  events?: OsvEvent[];
};

type OsvAffected = {
  package?: { name?: unknown; ecosystem?: unknown };
  ranges?: OsvRange[];
  database_specific?: { severity?: unknown };
  ecosystem_specific?: { severity?: unknown };
};

type OsvVuln = {
  id?: unknown;
  aliases?: unknown;
  severity?: Array<{ score?: unknown }>;
  affected?: OsvAffected[];
  database_specific?: {
    severity?: unknown;
    cvss?: unknown;
    cvss_score?: unknown;
    cvssScore?: unknown;
  };
};

export type OsvCollection = {
  findings: DraftFinding[];
  errors: ScanError[];
};

export async function collectOsvFindings(
  packages: InstalledPackage[],
  fetchImpl: FetchLike,
): Promise<OsvCollection> {
  if (packages.length === 0) return { findings: [], errors: [] };

  const failures: string[] = [];
  const findings: DraftFinding[] = [];
  await mapPool(packages, OSV_CONCURRENCY, async (pkg) => {
    try {
      const vulns = await queryOsv(pkg, fetchImpl);
      findings.push(...vulns.flatMap((vuln) => findingsFromVuln(vuln, pkg)));
    } catch (error) {
      failures.push(`${pkg.name}@${pkg.version}: ${errorMessage(error)}`);
    }
  });

  if (failures.length === 0) return { findings, errors: [] };
  return {
    findings,
    errors: [
      {
        source: "osv",
        message: truncate(`OSV query failed for ${failures.length} package(s). ${failures.slice(0, 3).join(" ")}`),
      },
    ],
  };
}

async function queryOsv(pkg: InstalledPackage, fetchImpl: FetchLike): Promise<OsvVuln[]> {
  const response = await fetchImpl(OSV_QUERY_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      package: { name: pkg.name, ecosystem: "npm" },
      version: pkg.version,
    }),
    signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("response was not JSON");
  }

  if (!isRecord(payload)) throw new Error("response was not a JSON object");
  const vulns = payload.vulns;
  if (vulns === undefined) return [];
  if (!Array.isArray(vulns)) throw new Error("response did not include a vulnerability list");
  return vulns.filter(isRecord) as OsvVuln[];
}

function findingsFromVuln(vuln: OsvVuln, pkg: InstalledPackage): DraftFinding[] {
  const id = stringValue(vuln.id);
  if (!id) return [];
  const aliases = Array.isArray(vuln.aliases)
    ? vuln.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
    : [];
  const finding: DraftFinding = {
    packageName: pkg.name,
    installedVersion: pkg.version,
    vulnerabilityId: canonicalVulnerabilityId(id),
    severity: osvSeverity(vuln),
    source: "osv",
    aliases: aliases.map(canonicalVulnerabilityId),
  };
  const cvssScore = osvCvss(vuln);
  const fixedVersion = osvFixedVersion(vuln, pkg);
  if (cvssScore !== undefined) finding.cvssScore = cvssScore;
  if (fixedVersion) finding.fixedVersion = fixedVersion;
  return [finding];
}

function osvSeverity(vuln: OsvVuln): DraftFinding["severity"] {
  const candidates: unknown[] = [vuln.database_specific?.severity];
  for (const affected of vuln.affected ?? []) {
    candidates.push(affected.database_specific?.severity, affected.ecosystem_specific?.severity);
  }
  for (const candidate of candidates) {
    const severity = mapSeverity(candidate);
    if (severity !== "UNKNOWN") return severity;
  }
  return "UNKNOWN";
}

function osvCvss(vuln: OsvVuln): number | undefined {
  for (const entry of vuln.severity ?? []) {
    const score = numericScore(entry?.score);
    if (score !== undefined) return score;
  }
  const database = vuln.database_specific;
  if (!database) return undefined;
  const direct = numericScore(database.cvssScore ?? database.cvss_score);
  if (direct !== undefined) return direct;
  if (isRecord(database.cvss)) return numericScore(database.cvss.score);
  return numericScore(database.cvss);
}

function osvFixedVersion(vuln: OsvVuln, pkg: InstalledPackage): string | undefined {
  const affected = vuln.affected ?? [];
  const matching = affected.filter((entry) => {
    const name = stringValue(entry.package?.name);
    const ecosystem = stringValue(entry.package?.ecosystem);
    return name === pkg.name && (!ecosystem || ecosystem.toLowerCase() === "npm");
  });
  const entries = matching.length > 0 ? matching : affected;
  const fixedVersions = entries.flatMap((entry) =>
    (entry.ranges ?? []).flatMap((range) =>
      (range.events ?? []).flatMap((event) => {
        const fixed = stringValue(event.fixed);
        return fixed ? [fixed] : [];
      }),
    ),
  );
  if (fixedVersions.length === 0) return undefined;
  if (!semver.valid(pkg.version)) return fixedVersions[0];
  const greater = fixedVersions
    .filter((version) => semver.valid(version) && semver.gt(version, pkg.version))
    .sort(semver.compare);
  return greater[0] ?? fixedVersions[0];
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "request failed";
}

function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
