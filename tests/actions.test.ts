import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.SECUREREPO_SCAN_DELAY_MS = "0";
process.env.SECUREREPO_CALLBACK_SECRET = "test-secret";

const { addGitHubRepository, startActionsScan } = await import("@/lib/scans/runner");
const { acceptScanCallback, authorizeCallback, callbackEndpoint, isPublicCallbackUrl, parseCallbackBody } = await import(
  "@/lib/scans/callback"
);
const { dispatchSecurityScan } = await import("@/lib/github/dispatch-workflow");
const { disconnectStore, getStore, resetStore } = await import("@/lib/store");

describe("GitHub Actions scan", () => {
  beforeAll(async () => {
    await resetStore();
  });

  afterAll(async () => {
    await disconnectStore();
  });

  it("keeps the workflow file on fixed commands", async () => {
    const text = await readFile(path.join(process.cwd(), ".github/workflows/security-scan.yml"), "utf8");
    expect(text).toContain("workflow_dispatch");
    expect(text).toContain("repository:");
    expect(text).toContain("scan_id:");
    expect(text).toContain("secrets.SECUREREPO_CALLBACK_SECRET");
    expect(text).toContain("actions/checkout@v4");
    for (const line of text.split("\n")) {
      if (line.includes("run:")) expect(line).not.toContain("${{");
    }
  });

  it("rejects a callback without the shared secret", async () => {
    expect(authorizeCallback("Bearer wrong-secret")).toBe(false);
    expect(authorizeCallback(null)).toBe(false);
    const missing = await acceptScanCallback("missing", "Bearer test-secret", { status: "running" }, {});
    expect(missing).toMatchObject({ ok: false, status: 503 });
    const rejected = await acceptScanCallback("missing", "Bearer no", { status: "running" });
    expect(rejected).toMatchObject({ ok: false, status: 401 });
  });

  it("accepts normalized findings only from a matching secret", async () => {
    const saved = await addGitHubRepository("https://github.com/octocat/Hello-World");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const started = await startActionsScan(saved.repository.id, {
      callbackUrl: "https://scanner.example.com",
      dispatch: async () => ({ ok: true }),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.scan.status).toBe("pending");
    expect(started.scan.runner).toBe("actions");

    const invalid = await acceptScanCallback(started.scan.id, "Bearer test-secret", {
      status: "completed",
      findings: [{ packageName: "left-pad", installedVersion: "1.0.0", vulnerabilityId: "GHSA-test", severity: "NOPE", source: "osv" }],
    });
    expect(invalid).toMatchObject({ ok: false, status: 400 });

    const accepted = await acceptScanCallback(started.scan.id, "Bearer test-secret", {
      status: "completed",
      findings: [
        {
          packageName: "left-pad",
          installedVersion: "1.0.0",
          vulnerabilityId: "GHSA-test",
          severity: "HIGH",
          source: "osv",
          fixedVersion: "1.0.1",
        },
      ],
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.scan.status).toBe("completed");
    expect(accepted.scan.findings).toHaveLength(1);

    const again = await acceptScanCallback(started.scan.id, "Bearer test-secret", { status: "running" });
    expect(again).toMatchObject({ ok: false, status: 409 });
  });

  it("dispatches the workflow with the repository URL and scan id", async () => {
    const requested = { url: "", body: "", authorization: "" };
    const result = await dispatchSecurityScan(
      {
        repositoryUrl: "https://github.com/lodash/lodash",
        scanId: "11111111-1111-4111-8111-111111111111",
        callbackUrl: "https://scanner.example.com",
      },
      { SECUREREPO_GITHUB_TOKEN: "token-value", SECUREREPO_ACTIONS_REPO: "nourhb/DevSecOps_Security_Scanner" },
      async (url, init) => {
        requested.url = url;
        requested.body = String(init?.body ?? "");
        const headers = init?.headers;
        requested.authorization =
          headers && !Array.isArray(headers) && !(headers instanceof Headers) ? String(headers.authorization ?? "") : "";
        return new Response(null, { status: 204 });
      },
    );
    expect(result.ok).toBe(true);
    expect(requested.url).toBe(
      "https://api.github.com/repos/nourhb/DevSecOps_Security_Scanner/actions/workflows/security-scan.yml/dispatches",
    );
    const body = JSON.parse(requested.body) as { ref: string; inputs: Record<string, string> };
    expect(body.ref).toBe("main");
    expect(body.inputs.repository).toBe("https://github.com/lodash/lodash");
    expect(body.inputs.scan_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.inputs.callback_url).toBe("https://scanner.example.com");
    expect(requested.authorization).toBe("Bearer token-value");
    expect(callbackEndpoint("https://scanner.example.com/ignored", body.inputs.scan_id)).toBe(
      "https://scanner.example.com/api/scans/11111111-1111-4111-8111-111111111111/results",
    );
    expect(isPublicCallbackUrl("http://127.0.0.1:43123")).toBe(false);
    expect(parseCallbackBody({ status: "failed" })).toMatchObject({ ok: false });
  });

  it("runs the scanner locally when Actions cannot be dispatched", async () => {
    await getStore().insertRepository({
      id: "fixture-vulnerable",
      kind: "fixture",
      owner: "local",
      name: "vulnerable",
      url: "",
      createdAt: new Date().toISOString(),
    });
    const actions = await startActionsScan("fixture-vulnerable", { callbackUrl: "http://127.0.0.1:43123" });
    expect(actions.ok).toBe(true);
    if (!actions.ok) return;
    expect(actions.scan.warnings.join(" ")).toContain("running in this app instead");
    const finished = await waitForTerminal(actions.scan.id);
    expect(finished.status).toBe("completed");
    expect(finished.runner).toBe("local");
    expect(finished.findings.length).toBeGreaterThan(0);
    expect(finished.findings.every((finding) => finding.packageName === "lodash")).toBe(true);
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
