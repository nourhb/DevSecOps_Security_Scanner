import { describe, expect, it } from "vitest";

import { buildReport, compareScans, countStatuses, summarize, type Repository, type ScanRecord } from "@/lib/domain";
import type { Finding } from "@/lib/scanner/types";
import { parseGitHubRepoUrl } from "@/lib/github/parse-url";
import { renderScanPdf } from "@/lib/reports/pdf";

const lodash = (id: string, version = "4.17.20"): Finding => ({
  packageName: "lodash",
  installedVersion: version,
  vulnerabilityId: id,
  severity: "HIGH",
  source: "npm-audit",
  fixedVersion: "4.17.21",
});

describe("compareScans", () => {
  it("marks a vulnerability fixed only when a later scan drops that id for the package", () => {
    const previous = [lodash("GHSA-keep"), lodash("GHSA-gone"), { ...lodash("GHSA-other-pkg"), packageName: "left-pad" }];
    const current = [lodash("GHSA-keep", "4.17.21"), { ...lodash("GHSA-new"), packageName: "minimist" }];
    const rows = compareScans(previous, current);
    const counts = countStatuses(rows);

    expect(counts).toEqual({ new: 1, open: 1, fixed: 2 });
    expect(rows.find((row) => row.vulnerabilityId === "GHSA-keep")?.status).toBe("open");
    expect(rows.find((row) => row.vulnerabilityId === "GHSA-new")?.status).toBe("new");
    expect(rows.find((row) => row.vulnerabilityId === "GHSA-gone")?.status).toBe("fixed");
    expect(rows.find((row) => row.packageName === "left-pad")?.status).toBe("fixed");
  });

  it("does not treat the same vulnerability id on a different package as fixed", () => {
    const rows = compareScans([lodash("GHSA-same")], [{ ...lodash("GHSA-same"), packageName: "other" }]);
    expect(countStatuses(rows)).toEqual({ new: 1, open: 0, fixed: 1 });
  });
});

describe("parseGitHubRepoUrl", () => {
  it("accepts a github.com repository URL and ignores a .git suffix", () => {
    expect(parseGitHubRepoUrl("https://github.com/lodash/lodash.git")).toEqual({
      ok: true,
      repo: { owner: "lodash", name: "lodash", url: "https://github.com/lodash/lodash" },
    });
  });

  it("rejects other hosts, extra paths, and shell metacharacters", () => {
    expect(parseGitHubRepoUrl("https://gitlab.com/lodash/lodash").ok).toBe(false);
    expect(parseGitHubRepoUrl("https://github.com/lodash/lodash/issues/1").ok).toBe(false);
    expect(parseGitHubRepoUrl("https://github.com/lodash/lodash;touch").ok).toBe(false);
    expect(parseGitHubRepoUrl("https://user:token@github.com/lodash/lodash").ok).toBe(false);
  });
});

describe("summarize and reports", () => {
  it("counts the latest completed scan per repository", () => {
    const repo = repository();
    const older = scan(repo.id, "2026-10-15T00:00:00.000Z", [lodash("GHSA-old")]);
    const newer = scan(repo.id, "2026-10-15T01:00:00.000Z", [
      lodash("GHSA-new"),
      { ...lodash("GHSA-crit"), severity: "CRITICAL" },
    ]);
    const summary = summarize([repo], [older, newer]);
    expect(summary.totalFindings).toBe(2);
    expect(summary.criticalHigh).toBe(2);
    expect(summary.packagesAffected).toBe(1);
    expect(summary.lastScan?.id).toBe(newer.id);
  });

  it("builds a PDF that names the repository, status, and fix advice", async () => {
    const repo = repository();
    const current = scan(repo.id, "2026-10-15T02:00:00.000Z", [lodash("GHSA-keep")]);
    const report = buildReport(repo, current, null);
    expect(report.repository.label).toBe("lodash/lodash");
    expect(report.scan.statusLabel).toBe("Completed");
    expect(report.findings[0]?.vulnerabilityId).toBe("GHSA-keep");
    expect(report.fixAdvice[0]).toContain("Upgrade lodash");
    const pdf = Buffer.from(await renderScanPdf(report));
    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });
});

function repository(): Repository {
  return {
    id: "repo-1",
    kind: "github",
    owner: "lodash",
    name: "lodash",
    url: "https://github.com/lodash/lodash",
    createdAt: "2026-10-15T00:00:00.000Z",
  };
}

function scan(repositoryId: string, createdAt: string, findings: Finding[]): ScanRecord {
  return {
    id: `scan-${createdAt}`,
    repositoryId,
    status: "completed",
    createdAt,
    startedAt: createdAt,
    finishedAt: createdAt,
    error: null,
    warnings: [],
    findings,
  };
}
