import { describe, expect, it } from "vitest";

import { fetchGitHubManifests } from "@/lib/github/fetch-manifests";

describe("fetchGitHubManifests", () => {
  it("reads package.json from the GitHub API and allows a missing lockfile", async () => {
    const urls: string[] = [];
    const packageJson = JSON.stringify({ name: "demo", version: "1.0.0" });
    const result = await fetchGitHubManifests("demo", "repo", async (url) => {
      urls.push(url);
      if (url.endsWith("/contents/package.json")) {
        return json({ content: Buffer.from(packageJson).toString("base64"), encoding: "base64" });
      }
      return new Response("missing", { status: 404 });
    });

    expect(urls[0]).toBe("https://api.github.com/repos/demo/repo/contents/package.json");
    expect(result).toEqual({
      ok: true,
      files: { packageJson, packageLock: null },
    });
  });

  it("does not call fetch when the repository name is unsafe", async () => {
    let called = false;
    const result = await fetchGitHubManifests("owner", "repo;rm", async () => {
      called = true;
      return new Response("nope");
    });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
