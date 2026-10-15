"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useLiveJson } from "@/components/use-live-json";

type RepoRow = {
  id: string;
  kind: "github" | "fixture";
  label: string;
  url: string;
  scanCount: number;
  activeScan: boolean;
};

type ReposResponse = { repositories: RepoRow[] };

function shouldPollRepos(body: ReposResponse) {
  return body.repositories.some((repository) => repository.activeScan);
}

export function ReposView() {
  const router = useRouter();
  const { data, error, loading, retry } = useLiveJson<ReposResponse>("/api/repos", shouldPollRepos);
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function addRepository(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setAdding(true);
    try {
      const response = await fetch("/api/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; repository?: { id: string } } | null;
      if (!response.ok || !body?.repository) {
        setFormError(body?.error ?? "That repository could not be saved.");
        return;
      }
      setUrl("");
      router.push(`/repos/${body.repository.id}`);
    } catch {
      setFormError("The request failed before the repository was saved.");
    } finally {
      setAdding(false);
    }
  }

  async function scanFixture(name: "clean" | "vulnerable") {
    setActionError(null);
    setStarting(name);
    try {
      const response = await fetch(`/api/fixtures/${name}/scans`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { error?: string; scan?: { id: string } } | null;
      if (!response.ok || !body?.scan) {
        setActionError(body?.error ?? "The fixture scan did not start.");
        return;
      }
      router.push(`/scans/${body.scan.id}`);
    } catch {
      setActionError("The request failed before the scan started.");
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Repositories</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Add a public GitHub repository, then start a scan. SecureRepo reads package.json and package-lock.json from
          the GitHub API. The same repository cannot be added twice.
        </p>
      </div>

      <form onSubmit={addRepository} className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-4">
        <label htmlFor="repo-url" className="text-sm font-medium">
          GitHub repository URL
        </label>
        <input
          id="repo-url"
          name="url"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://github.com/lodash/lodash"
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" disabled={adding}>
            {adding ? "Adding repository…" : "Add repository"}
          </Button>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">github.com only. Issues, files, and credentials are rejected.</p>
          )}
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Included fixtures</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          These projects ship with SecureRepo, so you can run a scan without GitHub. The vulnerable fixture pins lodash
          4.17.20. Scan one twice to compare new, still open, and fixed findings.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" disabled={starting !== null} onClick={() => scanFixture("clean")}>
            {starting === "clean" ? "Starting clean scan…" : "Scan clean fixture"}
          </Button>
          <Button type="button" variant="outline" disabled={starting !== null} onClick={() => scanFixture("vulnerable")}>
            {starting === "vulnerable" ? "Starting vulnerable scan…" : "Scan vulnerable fixture"}
          </Button>
        </div>
        {actionError ? (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Saved repositories</h2>
        {loading && !data ? <p className="text-sm text-muted-foreground">Loading saved repositories.</p> : null}
        {error && !data ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4" role="alert">
            <p className="font-medium text-destructive">The repository list could not load</p>
            <p className="mt-1 text-sm">{error}</p>
            <Button type="button" className="mt-3" variant="outline" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : null}
        {data && data.repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories saved yet. Add a GitHub URL above, or scan a fixture to create the first record.
          </p>
        ) : null}
        {data && data.repositories.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {data.repositories.map((repository) => (
              <li key={repository.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link href={`/repos/${repository.id}`} className="font-medium underline-offset-4 hover:underline">
                    {repository.label}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {repository.kind === "github" ? repository.url : "Local fixture"} · {repository.scanCount}{" "}
                    {repository.scanCount === 1 ? "scan" : "scans"}
                    {repository.activeScan ? " · scan in progress" : ""}
                  </p>
                </div>
                <Link href={`/repos/${repository.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
