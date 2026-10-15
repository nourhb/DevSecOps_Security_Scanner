"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { findingStatusLabel, formatWhen, type FindingStatus, type ScanReport } from "@/lib/domain";
import type { Severity } from "@/lib/scanner/types";
import { buttonVariants } from "@/components/ui/button";
import { FindingStatusBadge, ScanStatusBadge, SeverityBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLiveJson } from "@/components/use-live-json";
import { cn } from "@/lib/utils";

const SEVERITY_FILTERS = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
const STATUS_FILTERS = ["all", "new", "open", "fixed"] as const;

function shouldPollScan(body: { report: ScanReport }) {
  return body.report.scan.status === "pending" || body.report.scan.status === "running";
}

export function ScanView({ id }: { id: string }) {
  const { data, error, loading, retry } = useLiveJson<{ report: ScanReport }>(`/api/scans/${id}`, shouldPollScan);
  const [severity, setSeverity] = useState<(typeof SEVERITY_FILTERS)[number]>("ALL");
  const [packageQuery, setPackageQuery] = useState("");
  const [idQuery, setIdQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");

  const report = data?.report;
  const filtered = useMemo(() => {
    if (!report) return [];
    const packageNeedle = packageQuery.trim().toLowerCase();
    const idNeedle = idQuery.trim().toLowerCase();
    return report.findings.filter((finding) => {
      if (severity !== "ALL" && finding.severity !== severity) return false;
      if (packageNeedle && !finding.packageName.toLowerCase().includes(packageNeedle)) return false;
      if (idNeedle && !finding.vulnerabilityId.toLowerCase().includes(idNeedle)) return false;
      if (status !== "all" && finding.status !== status) return false;
      return true;
    });
  }, [report, severity, packageQuery, idQuery, status]);

  if (loading && !report) return <Notice title="Loading the scan" body="Checking whether this run is pending, running, or finished." />;
  if (error && !report) {
    return (
      <Notice title="This scan could not load" body={error}>
        <Button type="button" onClick={retry}>
          Try again
        </Button>
      </Notice>
    );
  }
  if (!report) return null;

  const finished = report.scan.status === "completed" || report.scan.status === "failed";
  const filtersActive = severity !== "ALL" || packageQuery.trim() !== "" || idQuery.trim() !== "" || status !== "all";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href={`/repos/${report.repository.id}`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {report.repository.label}
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Scan</h1>
          <ScanStatusBadge status={report.scan.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Started {formatWhen(report.scan.startedAt ?? report.scan.createdAt)}
          {report.scan.finishedAt ? ` · Finished ${formatWhen(report.scan.finishedAt)}` : ""}
        </p>
        {report.repository.url ? (
          <a href={report.repository.url} className="text-sm underline-offset-4 hover:underline">
            {report.repository.url}
          </a>
        ) : null}
      </div>

      {report.scan.status === "pending" ? (
        <Notice title="Pending" body="The scan is queued. Status will change to Running when npm audit and OSV start." />
      ) : null}
      {report.scan.status === "running" ? (
        <Notice
          title="Running"
          body={
            report.repository.kind === "github"
              ? "Downloading package.json and package-lock.json from the GitHub API, then running npm audit and OSV."
              : "Running npm audit and checking the same packages against OSV."
          }
        />
      ) : null}
      {report.scan.status === "failed" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4" role="alert">
          <h2 className="font-medium text-destructive">Failed</h2>
          <p className="mt-1 text-sm leading-6">{report.scan.error ?? "The scan failed."}</p>
        </div>
      ) : null}
      {report.scan.warnings.length > 0 && report.scan.status === "completed" ? (
        <Notice title="Completed with warnings" body={report.scan.warnings.join(" ")} />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Findings" value={String(report.summary.totalFindings)} />
        <Stat label="Critical and high" value={String(report.summary.criticalHigh)} />
        <Stat label="Packages affected" value={String(report.summary.packagesAffected)} />
        <Stat label="Status" value={report.scan.statusLabel} />
      </section>

      {report.comparison ? (
        <section className="rounded-lg border bg-card px-4 py-4">
          <h2 className="font-medium">Compared with the previous scan</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {report.comparison.new} new, {report.comparison.open} still open, {report.comparison.fixed} fixed. A finding
            is fixed only when this scan no longer reports that vulnerability id for that package.
          </p>
          <Link
            href={`/scans/${report.comparison.previousScanId}`}
            className="mt-2 inline-block text-sm font-medium underline-offset-4 hover:underline"
          >
            Open previous scan
          </Link>
        </section>
      ) : report.scan.status === "completed" ? (
        <Notice
          title="First completed scan"
          body="Run this repository again to see which findings are new, still open, or fixed."
        />
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Findings</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            {finished ? (
              <>
                <a className={cn(buttonVariants({ variant: "outline" }))} href={`/api/scans/${id}/report?format=json`}>
                  Download JSON
                </a>
                <a className={cn(buttonVariants({ variant: "outline" }))} href={`/api/scans/${id}/report?format=pdf`}>
                  Download PDF
                </a>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">JSON and PDF downloads are available when the scan finishes.</p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium">
            Severity
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value as Severity | "ALL")}
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {SEVERITY_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {option === "ALL" ? "All severities" : option}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Package
            <input
              value={packageQuery}
              onChange={(event) => setPackageQuery(event.target.value)}
              placeholder="lodash"
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="text-sm font-medium">
            Vulnerability id
            <input
              value={idQuery}
              onChange={(event) => setIdQuery(event.target.value)}
              placeholder="GHSA or CVE"
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="text-sm font-medium">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as FindingStatus | "all")}
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All statuses" : findingStatusLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSeverity("ALL");
              setPackageQuery("");
              setIdQuery("");
              setStatus("all");
            }}
          >
            Clear filters
          </Button>
        ) : null}

        {report.scan.status === "completed" && report.findings.length === 0 ? (
          <Notice title="No vulnerabilities found" body="npm audit and OSV did not report findings for this project." />
        ) : null}
        {report.findings.length > 0 && filtered.length === 0 ? (
          <Notice title="No findings match these filters" body="Clear the filters to see the full list again." />
        ) : null}
        {filtered.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Vulnerability</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Fixed version</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((finding) => (
                <TableRow key={`${finding.status}:${finding.packageName}:${finding.vulnerabilityId}`}>
                  <TableCell className="font-medium">{finding.packageName}</TableCell>
                  <TableCell className="font-mono text-xs">{finding.installedVersion}</TableCell>
                  <TableCell className="font-mono text-xs">{finding.vulnerabilityId}</TableCell>
                  <TableCell>
                    <SeverityBadge severity={finding.severity} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{finding.fixedVersion ?? "—"}</TableCell>
                  <TableCell>{finding.source === "npm-audit" ? "npm audit" : "OSV"}</TableCell>
                  <TableCell>
                    <FindingStatusBadge status={finding.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>

      {report.fixAdvice.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight">What to do next</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            {report.fixAdvice.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-4" aria-live="polite">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{body}</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
