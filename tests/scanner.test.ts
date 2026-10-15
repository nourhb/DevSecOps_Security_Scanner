import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SEVERITIES, scanDirectory } from "@/lib/scanner";
import type { Finding, ScanResult } from "@/lib/scanner/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanFixture = path.join(root, "fixtures", "clean");
const vulnerableFixture = path.join(root, "fixtures", "vulnerable");

describe("scanDirectory", () => {
  it("returns no findings for the clean fixture", async () => {
    const result = await scanDirectory(cleanFixture, {
      fetchImpl: async () => {
        throw new Error("OSV should not be queried when the lockfile has no packages");
      },
    });

    expect(result).toEqual({ findings: [], errors: [] });
  });

  it("returns real findings for the vulnerable fixture", async () => {
    const result = await scanDirectory(vulnerableFixture);

    expect(result.errors).toEqual([]);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((finding) => finding.source === "npm-audit")).toBe(true);

    const lodash = result.findings.filter(
      (finding) => finding.packageName === "lodash" && finding.installedVersion === "4.17.20",
    );
    expect(lodash.length).toBeGreaterThan(0);
    expect(lodash.some((finding) => typeof finding.fixedVersion === "string" && finding.fixedVersion.length > 0)).toBe(
      true,
    );
    expect(lodash.some((finding) => typeof finding.cvssScore === "number")).toBe(true);

    for (const finding of result.findings) assertFindingShape(finding);

    const keys = result.findings.map(findingKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("deduplicates a vulnerability reported by both npm audit and OSV", async () => {
    const auditOnly = await scanDirectory(vulnerableFixture, {
      fetchImpl: async () => jsonResponse({ vulns: [] }),
    });
    const auditFinding = auditOnly.findings.find((finding) => finding.source === "npm-audit");
    expect(auditFinding).toBeDefined();
    if (!auditFinding) return;

    const result = await scanDirectory(vulnerableFixture, {
      fetchImpl: async () =>
        jsonResponse({
          vulns: [
            {
              id: "OSV-ALIAS-WRAPPER",
              aliases: [auditFinding.vulnerabilityId],
              affected: [
                {
                  package: { name: auditFinding.packageName, ecosystem: "npm" },
                  ranges: [{ events: [{ introduced: "0" }, { fixed: "9.9.9" }] }],
                },
              ],
            },
          ],
        }),
    });

    const matches = result.findings.filter(
      (finding) =>
        finding.packageName === auditFinding.packageName &&
        finding.installedVersion === auditFinding.installedVersion &&
        finding.vulnerabilityId === auditFinding.vulnerabilityId,
    );
    expect(matches).toHaveLength(1);
    expect(result.findings.some((finding) => finding.vulnerabilityId === "OSV-ALIAS-WRAPPER")).toBe(false);
    expect(result.findings).toHaveLength(auditOnly.findings.length);
    expect(result.errors).toEqual([]);
  });

  it("keeps distinct npm advisories that OSV cross-links with aliases", async () => {
    const auditOnly = await scanDirectory(vulnerableFixture, {
      fetchImpl: async () => jsonResponse({ vulns: [] }),
    });
    expect(auditOnly.findings.length).toBeGreaterThan(1);
    const [first, second] = auditOnly.findings;

    const result = await scanDirectory(vulnerableFixture, {
      fetchImpl: async () =>
        jsonResponse({
          vulns: [
            {
              id: first.vulnerabilityId,
              aliases: [second.vulnerabilityId],
            },
          ],
        }),
    });

    expect(result.findings.map((finding) => finding.vulnerabilityId).sort()).toEqual(
      auditOnly.findings.map((finding) => finding.vulnerabilityId).sort(),
    );
  });

  it("does not invent a CVSS score when OSV only provides a vector", async () => {
    const result = await scanDirectory(vulnerableFixture, {
      fetchImpl: async () =>
        jsonResponse({
          vulns: [
            {
              id: "OSV-VECTOR-ONLY",
              severity: [
                {
                  type: "CVSS_V3",
                  score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                },
              ],
            },
          ],
        }),
    });

    const finding = result.findings.find((item) => item.vulnerabilityId === "OSV-VECTOR-ONLY");
    expect(finding).toMatchObject({
      packageName: "lodash",
      installedVersion: "4.17.20",
      severity: "UNKNOWN",
      source: "osv",
    });
    expect(finding && "cvssScore" in finding).toBe(false);
  });

  it("returns a structured error when OSV fails and still keeps audit findings", async () => {
    const result = await scanDirectory(vulnerableFixture, {
      fetchImpl: async () => new Response("upstream down", { status: 503 }),
    });

    expect(result.errors).toEqual([
      expect.objectContaining({
        source: "osv",
        message: expect.stringContaining("HTTP 503"),
      }),
    ]);
    expect(result.findings.some((finding) => finding.source === "npm-audit")).toBe(true);
  });

  it("returns a structured error for a missing project and does not throw", async () => {
    const result = await scanDirectory(path.join(root, "fixtures", "missing"));
    expect(result.findings).toEqual([]);
    expect(result.errors).toEqual([
      { source: "input", message: "The directory does not exist." },
    ]);
  });

  it("does not pass the directory path through a shell", async () => {
    const marker = path.join(tmpdir(), `securerepo-marker-${process.pid}.txt`);
    const parent = await mkdtemp(path.join(tmpdir(), "securerepo-shell-"));
    const hostile = path.join(parent, `scan $(touch ${marker})`);
    await rm(marker, { force: true });
    await cp(cleanFixture, hostile, { recursive: true });

    let result: ScanResult | undefined;
    let thrown: unknown;
    try {
      result = await scanDirectory(hostile, {
        fetchImpl: async () => {
          throw new Error("OSV should not be queried");
        },
      });
    } catch (error) {
      thrown = error;
    } finally {
      await rm(parent, { recursive: true, force: true });
    }

    expect(thrown).toBeUndefined();
    expect(result).toEqual({ findings: [], errors: [] });
    await expect(access(marker)).rejects.toThrow();
  });
});

function assertFindingShape(finding: Finding) {
  expect(finding.packageName.length).toBeGreaterThan(0);
  expect(finding.installedVersion.length).toBeGreaterThan(0);
  expect(finding.vulnerabilityId.length).toBeGreaterThan(0);
  expect(SEVERITIES).toContain(finding.severity);
  expect(["npm-audit", "osv"]).toContain(finding.source);
  if ("cvssScore" in finding) {
    expect(typeof finding.cvssScore).toBe("number");
    expect(Number.isFinite(finding.cvssScore)).toBe(true);
  }
  if ("fixedVersion" in finding) {
    expect(typeof finding.fixedVersion).toBe("string");
    expect(finding.fixedVersion?.length).toBeGreaterThan(0);
  }
}

function findingKey(finding: Finding): string {
  return `${finding.packageName}\0${finding.installedVersion}\0${finding.vulnerabilityId}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
