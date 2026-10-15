import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.SECUREREPO_SCAN_DELAY_MS = "0";

const { addGitHubRepository, startFixtureScan } = await import("@/lib/scans/runner");
const { disconnectStore, getStore, resetStore } = await import("@/lib/store");

describe("saved scans", () => {
  beforeAll(async () => {
    await resetStore();
  });

  afterAll(async () => {
    await disconnectStore();
  });

  it("rejects a duplicate GitHub repository", async () => {
    const first = await addGitHubRepository("https://github.com/lodash/lodash");
    const second = await addGitHubRepository("https://GitHub.com/Lodash/Lodash.git");
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, status: 409 });
  });

  it("runs the vulnerable fixture and keeps real findings", async () => {
    const started = await startFixtureScan("vulnerable");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.scan.status).toBe("pending");

    const finished = await waitForTerminal(started.scan.id);
    expect(finished.status).toBe("completed");
    expect(finished.findings.length).toBeGreaterThan(0);
    expect(finished.findings.every((finding) => finding.packageName === "lodash")).toBe(true);
    expect(finished.findings.every((finding) => finding.installedVersion === "4.17.20")).toBe(true);
    expect(finished.remediations?.length).toBeGreaterThan(0);
    expect(finished.remediations?.[0]?.advice).toContain("Upgrade lodash");
  });
});

async function waitForTerminal(id: string) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const scan = await getStore().getScan(id);
    if (scan && scan.status !== "pending" && scan.status !== "running") return scan;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Scan did not finish.");
}
