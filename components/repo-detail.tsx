"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatWhen, type ScanStatus } from "@/lib/domain";
import { ScanStatusBadge } from "@/components/status-badge";
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

type RepoDetailResponse = {
  repository: {
    id: string;
    kind: "github" | "fixture";
    label: string;
    url: string;
    owner: string;
    name: string;
  };
  scans: Array<{
    id: string;
    status: ScanStatus;
    createdAt: string;
    finishedAt: string | null;
    error: string | null;
    findingCount: number;
  }>;
};

function shouldPollRepo(body: RepoDetailResponse) {
  return body.scans.some((scan) => scan.status === "pending" || scan.status === "running");
}

export function RepoDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, loading, retry } = useLiveJson<RepoDetailResponse>(`/api/repos/${id}`, shouldPollRepo);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function startScan() {
    setActionError(null);
    setStarting(true);
    try {
      const response = await fetch(`/api/repos/${id}/scans`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { error?: string; scan?: { id: string } } | null;
      if (!response.ok || !body?.scan) {
        setActionError(body?.error ?? "The scan did not start.");
        return;
      }
      router.push(`/scans/${body.scan.id}`);
    } catch {
      setActionError("The request failed before the scan started.");
    } finally {
      setStarting(false);
    }
  }

  if (loading && !data) return <Notice title="Loading repository" body="Reading saved scans for this project." />;
  if (error && !data) {
    return (
      <Notice title="This repository could not load" body={error}>
        <Button type="button" onClick={retry}>
          Try again
        </Button>
      </Notice>
    );
  }
  if (!data) return null;

  const busy = data.scans.some((scan) => scan.status === "pending" || scan.status === "running");
  const repository = data.repository;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/repos" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          All repositories
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{repository.label}</h1>
        {repository.kind === "github" ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            A scan downloads{" "}
            <a className="underline-offset-4 hover:underline" href={repository.url}>
              {repository.url}
            </a>{" "}
            package.json and package-lock.json from the public GitHub API, then runs npm audit and OSV.
          </p>
        ) : (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            This is a local fixture. Scanning it does not call GitHub.
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" disabled={starting || busy} onClick={startScan}>
            {starting ? "Starting scan…" : busy ? "Scan in progress" : "Start scan"}
          </Button>
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Scans</h2>
        {data.scans.length === 0 ? (
          <Notice title="No scans yet" body="Start a scan to fetch the lockfile and list vulnerabilities." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Findings</TableHead>
                <TableHead>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.scans.map((scan) => (
                <TableRow key={scan.id}>
                  <TableCell>{formatWhen(scan.finishedAt ?? scan.createdAt)}</TableCell>
                  <TableCell>
                    <ScanStatusBadge status={scan.status} />
                  </TableCell>
                  <TableCell>{scan.status === "completed" ? scan.findingCount : "—"}</TableCell>
                  <TableCell>
                    <Link href={`/scans/${scan.id}`} className="font-medium underline-offset-4 hover:underline">
                      View scan
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-4">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
