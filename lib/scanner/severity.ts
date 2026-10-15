import type { Severity } from "@/lib/scanner/types";

const RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNKNOWN: 0,
};

export function mapSeverity(value: unknown): Severity {
  if (typeof value !== "string") return "UNKNOWN";
  switch (value.trim().toLowerCase()) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "HIGH";
    case "moderate":
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
    default:
      return "UNKNOWN";
  }
}

export function severityRank(severity: Severity): number {
  return RANK[severity];
}

/** Use a number only when the source already provided one. Vector strings are not scores. */
export function numericScore(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
