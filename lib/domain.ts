import type { Finding, ScanError, Severity } from "@/lib/scanner/types";

export const SCAN_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const FINDING_STATUSES = ["new", "open", "fixed"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export type RepositoryKind = "github" | "fixture";

export type Repository = {
  id: string;
  kind: RepositoryKind;
  owner: string;
  name: string;
  url: string;
  createdAt: string;
};

export type ScanRunner = "local" | "actions";

export type ScanRecord = {
  id: string;
  repositoryId: string;
  status: ScanStatus;
  /** Where the scanner process ran. Missing records ran in this app. */
  runner?: ScanRunner;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  warnings: string[];
  findings: Finding[];
};

export type ComparedFinding = Finding & {
  status: FindingStatus;
};

export type StatusCounts = {
  new: number;
  open: number;
  fixed: number;
};

export function scanRunnerLabel(runner: ScanRunner | undefined): string {
  return runner === "actions" ? "GitHub Actions" : "This app";
}

export function scanStatusLabel(status: ScanStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

export function findingStatusLabel(status: FindingStatus): string {
  switch (status) {
    case "new":
      return "New";
    case "open":
      return "Still open";
    case "fixed":
      return "Fixed";
  }
}

export function repositoryLabel(repository: Pick<Repository, "kind" | "owner" | "name">): string {
  if (repository.kind === "fixture") {
    return repository.name === "clean" ? "Clean fixture" : "Vulnerable fixture";
  }
  return `${repository.owner}/${repository.name}`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function findingKey(finding: Pick<Finding, "packageName" | "vulnerabilityId">): string {
  return `${finding.packageName}\0${finding.vulnerabilityId}`;
}

/** A later scan marks a finding fixed only when that package no longer has the same vulnerability id. */
export function compareScans(previous: Finding[] | null, current: Finding[]): ComparedFinding[] {
  if (!previous) {
    return current.map((finding) => ({ ...finding, status: "open" }));
  }

  const previousKeys = new Set(previous.map(findingKey));
  const currentKeys = new Set(current.map(findingKey));
  const rows: ComparedFinding[] = current.map((finding) => ({
    ...finding,
    status: previousKeys.has(findingKey(finding)) ? "open" : "new",
  }));

  for (const finding of previous) {
    if (!currentKeys.has(findingKey(finding))) {
      rows.push({ ...finding, status: "fixed" });
    }
  }

  return rows.sort(compareRows);
}

export function countStatuses(findings: ComparedFinding[]): StatusCounts {
  return {
    new: findings.filter((finding) => finding.status === "new").length,
    open: findings.filter((finding) => finding.status === "open").length,
    fixed: findings.filter((finding) => finding.status === "fixed").length,
  };
}

export function previousCompletedScan(scans: ScanRecord[], current: ScanRecord): ScanRecord | null {
  return (
    scans
      .filter(
        (scan) =>
          scan.repositoryId === current.repositoryId &&
          scan.id !== current.id &&
          scan.status === "completed" &&
          scan.createdAt < current.createdAt,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  );
}

export type DashboardSummary = {
  totalFindings: number;
  criticalHigh: number;
  packagesAffected: number;
  repositoryCount: number;
  lastScan: ScanRecord | null;
};

export function summarize(repositories: Repository[], scans: ScanRecord[]): DashboardSummary {
  const latestCompleted = new Map<string, ScanRecord>();
  for (const scan of [...scans].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (scan.status === "completed") latestCompleted.set(scan.repositoryId, scan);
  }
  const findings = [...latestCompleted.values()].flatMap((scan) => scan.findings);
  const lastScan = [...scans].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  return {
    totalFindings: findings.length,
    criticalHigh: findings.filter((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH").length,
    packagesAffected: new Set(findings.map((finding) => finding.packageName)).size,
    repositoryCount: repositories.length,
    lastScan,
  };
}

export type SeverityCounts = Record<Severity, number>;

export type ScanReport = {
  repository: {
    id: string;
    kind: RepositoryKind;
    owner: string;
    name: string;
    url: string;
    label: string;
  };
  scan: {
    id: string;
    status: ScanStatus;
    statusLabel: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    runner: ScanRunner;
    error: string | null;
    warnings: string[];
  };
  summary: {
    totalFindings: number;
    criticalHigh: number;
    packagesAffected: number;
    bySeverity: SeverityCounts;
  };
  comparison: (StatusCounts & { previousScanId: string }) | null;
  findings: ComparedFinding[];
  fixAdvice: string[];
};

export function buildReport(repository: Repository, scan: ScanRecord, previous: ScanRecord | null): ScanReport {
  const baseline = previous?.status === "completed" ? previous.findings : null;
  const findings =
    scan.status === "completed" ? compareScans(previous ? baseline : null, scan.findings) : [];
  const bySeverity = countSeverities(scan.findings);
  return {
    repository: {
      id: repository.id,
      kind: repository.kind,
      owner: repository.owner,
      name: repository.name,
      url: repository.url,
      label: repositoryLabel(repository),
    },
    scan: {
      id: scan.id,
      status: scan.status,
      statusLabel: scanStatusLabel(scan.status),
      createdAt: scan.createdAt,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      runner: scan.runner ?? "local",
      error: scan.error,
      warnings: scan.warnings,
    },
    summary: {
      totalFindings: scan.findings.length,
      criticalHigh: bySeverity.CRITICAL + bySeverity.HIGH,
      packagesAffected: new Set(scan.findings.map((finding) => finding.packageName)).size,
      bySeverity,
    },
    comparison:
      previous && scan.status === "completed"
        ? { ...countStatuses(findings), previousScanId: previous.id }
        : null,
    findings,
    fixAdvice: fixAdvice(scan.findings),
  };
}

export function fixAdvice(findings: Finding[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    const key = `${finding.packageName}@${finding.installedVersion}:${finding.vulnerabilityId}:${finding.fixedVersion ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (finding.fixedVersion) {
      lines.push(
        `Upgrade ${finding.packageName} from ${finding.installedVersion} to ${finding.fixedVersion} or newer to fix ${finding.vulnerabilityId}.`,
      );
    } else {
      lines.push(
        `No fixed version was reported for ${finding.packageName}@${finding.installedVersion} (${finding.vulnerabilityId}). Review the advisory before shipping.`,
      );
    }
  }
  return lines;
}

function countSeverities(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function compareRows(left: ComparedFinding, right: ComparedFinding): number {
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
  const statusOrder = { new: 0, open: 1, fixed: 2 };
  return (
    severityOrder[left.severity] - severityOrder[right.severity] ||
    statusOrder[left.status] - statusOrder[right.status] ||
    left.packageName.localeCompare(right.packageName) ||
    left.vulnerabilityId.localeCompare(right.vulnerabilityId)
  );
}

export function scannerWarnings(errors: ScanError[]): string[] {
  return errors.map((error) => error.message);
}
