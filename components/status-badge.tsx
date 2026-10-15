import { findingStatusLabel, scanStatusLabel, type FindingStatus, type ScanStatus } from "@/lib/domain";

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${scanClass(status)}`}>{scanStatusLabel(status)}</span>;
}

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${findingClass(status)}`}>
      {findingStatusLabel(status)}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${severityClass(severity)}`}>{severity}</span>;
}

function scanClass(status: ScanStatus): string {
  switch (status) {
    case "pending":
      return "bg-muted text-muted-foreground";
    case "running":
      return "bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100";
    case "completed":
      return "bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100";
    case "failed":
      return "bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100";
  }
}

function findingClass(status: FindingStatus): string {
  switch (status) {
    case "new":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100";
    case "open":
      return "bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100";
    case "fixed":
      return "bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100";
  }
}

function severityClass(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100";
    case "HIGH":
      return "bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100";
    case "MEDIUM":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100";
    case "LOW":
      return "bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100";
    default:
      return "bg-muted text-muted-foreground";
  }
}
