export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

export type Severity = (typeof SEVERITIES)[number];

export type FindingSource = "npm-audit" | "osv";

export type ScanErrorSource = "npm-audit" | "osv" | "input";

export type Finding = {
  packageName: string;
  installedVersion: string;
  vulnerabilityId: string;
  severity: Severity;
  cvssScore?: number;
  fixedVersion?: string;
  source: FindingSource;
};

export type ScanError = {
  source: ScanErrorSource;
  message: string;
};

export type ScanResult = {
  findings: Finding[];
  errors: ScanError[];
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ScanOptions = {
  fetchImpl?: FetchLike;
};

export type InstalledPackage = {
  name: string;
  version: string;
};

export type DraftFinding = Finding & {
  aliases: string[];
  /** Package-level npm fix, used only when neither source has an advisory-specific fix. */
  fallbackFixedVersion?: string;
};
