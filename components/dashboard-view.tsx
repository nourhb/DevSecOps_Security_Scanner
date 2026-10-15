"use client";

import Link from "next/link";

import { formatWhen, scanStatusLabel, type ScanStatus } from "@/lib/domain";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScanStatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLiveJson } from "@/components/use-live-json";

type DashboardResponse = {
  totalFindings: number;
  criticalHigh: number;
  packagesAffected: number;
  repositoryCount: number;
  lastScan: {
    id: string;
    status: ScanStatus;
    createdAt: string;
    finishedAt: string | null;
    repositoryId: string;
    repositoryLabel: string;
  } | null;
  recentScans: Array<{
    id: string;
    status: ScanStatus;
    createdAt: string;
    finishedAt: string | null;
    findingCount: number;
    repositoryId: string;
    repositoryLabel: string;
  }>;
};

function shouldPollDashboard(body: DashboardResponse) {
  return body.lastScan?.status === "pending" || body.lastScan?.status === "running";
}

export function DashboardView() {
  const { data, error, loading, retry } = useLiveJson<DashboardResponse>("/api/dashboard", shouldPollDashboard);

  if (loading && !data) {
    return <Message title="Loading the dashboard" body="Reading saved repositories and the latest scan." />;
  }
  if (error && !data) {
    return (
      <Message title="The dashboard could not load" body={error}>
        <Button type="button" onClick={retry}>
          Try again
        </Button>
      </Message>
    );
  }
  if (!data) return null;

  const last = data.lastScan;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Counts come from the latest completed scan of each saved repository. The last scan card follows whatever
          ran most recently, including a scan that is still in progress.
        </p>
      </div>

      {data.repositoryCount === 0 && data.recentScans.length === 0 ? (
        <Message
          title="No scans yet"
          body="Add a public GitHub repository, or run one of the included fixtures, to see findings here."
        >
          <Link href="/repos" className={cn(buttonVariants())}>
            Add a repository
          </Link>
        </Message>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total findings" value={String(data.totalFindings)} />
        <Metric label="Critical and high" value={String(data.criticalHigh)} />
        <Metric label="Packages affected" value={String(data.packagesAffected)} />
        <div className="rounded-lg border bg-card px-4 py-4">
          <p className="text-sm text-muted-foreground">Last scan</p>
          {last ? (
            <>
              <div className="mt-2">
                <ScanStatusBadge status={last.status} />
              </div>
              <p className="mt-2 text-sm">{formatWhen(last.finishedAt ?? last.createdAt)}</p>
              <p className="text-sm text-muted-foreground">{last.repositoryLabel}</p>
              <Link href={`/scans/${last.id}`} className="mt-2 inline-block text-sm font-medium underline-offset-4 hover:underline">
                Open scan
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm">No scan has been started.</p>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Recent scans</h2>
          <Link href="/repos" className="text-sm font-medium underline-offset-4 hover:underline">
            Repositories
          </Link>
        </div>
        {data.recentScans.length === 0 ? (
          <p className="text-sm text-muted-foreground">Scan history will show up here after the first run.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Findings</TableHead>
                <TableHead>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentScans.map((scan) => (
                <TableRow key={scan.id}>
                  <TableCell>
                    <Link href={`/repos/${scan.repositoryId}`} className="font-medium underline-offset-4 hover:underline">
                      {scan.repositoryLabel}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ScanStatusBadge status={scan.status} />
                  </TableCell>
                  <TableCell>{formatWhen(scan.finishedAt ?? scan.createdAt)}</TableCell>
                  <TableCell>{scan.status === "completed" ? scan.findingCount : "—"}</TableCell>
                  <TableCell>
                    <Link href={`/scans/${scan.id}`} className="font-medium underline-offset-4 hover:underline">
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {last ? <p className="text-xs text-muted-foreground">Status shown as {scanStatusLabel(last.status)}.</p> : null}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-4">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{body}</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
