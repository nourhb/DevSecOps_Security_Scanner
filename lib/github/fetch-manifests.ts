import type { FetchLike } from "@/lib/scanner/types";

const API = "https://api.github.com";

export type ManifestFiles = {
  packageJson: string;
  packageLock: string | null;
};

export async function fetchGitHubManifests(
  owner: string,
  name: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; files: ManifestFiles } | { ok: false; message: string }> {
  if (!isSafeName(owner) || !isSafeName(name)) {
    return { ok: false, message: "The repository name cannot be requested from GitHub." };
  }

  const packageJson = await fetchGitHubFile(owner, name, "package.json", fetchImpl);
  if (!packageJson.ok) {
    if (packageJson.status === 404) {
      return { ok: false, message: `${owner}/${name} has no package.json on the default branch.` };
    }
    return { ok: false, message: packageJson.message };
  }

  const packageLock = await fetchGitHubFile(owner, name, "package-lock.json", fetchImpl);
  if (!packageLock.ok && packageLock.status !== 404) {
    return { ok: false, message: packageLock.message };
  }

  return {
    ok: true,
    files: {
      packageJson: packageJson.text,
      packageLock: packageLock.ok ? packageLock.text : null,
    },
  };
}

async function fetchGitHubFile(
  owner: string,
  name: string,
  file: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodeURIComponent(file)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: githubHeaders() });
  } catch {
    return { ok: false, status: 0, message: `The request to GitHub for ${file} failed.` };
  }

  if (response.status === 404) {
    return { ok: false, status: 404, message: `${file} was not found on the default branch.` };
  }
  if (response.status === 403 || response.status === 429) {
    return { ok: false, status: response.status, message: "GitHub rate-limited the request. Wait a minute and scan again." };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, message: `GitHub returned HTTP ${response.status} for ${file}.` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 502, message: `GitHub returned a response for ${file} that was not JSON.` };
  }
  if (Array.isArray(body) || !isRecord(body)) {
    return { ok: false, status: 422, message: `${file} is not a file in this repository.` };
  }

  if (typeof body.content === "string" && body.content.trim()) {
    return { ok: true, text: decodeGitHubContent(body.content, stringField(body.encoding) ?? "base64") };
  }

  const sha = stringField(body.sha);
  if (sha && /^[a-f0-9]{40}$/i.test(sha)) {
    return fetchBlob(owner, name, sha, file, fetchImpl);
  }

  return { ok: false, status: 502, message: `GitHub did not include the contents of ${file}.` };
}

async function fetchBlob(
  owner: string,
  name: string,
  sha: string,
  file: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs/${sha}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: githubHeaders() });
  } catch {
    return { ok: false, status: 0, message: `The request to GitHub for ${file} failed.` };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, message: `GitHub returned HTTP ${response.status} while reading ${file}.` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 502, message: `GitHub returned a response for ${file} that was not JSON.` };
  }
  if (!isRecord(body) || typeof body.content !== "string") {
    return { ok: false, status: 502, message: `GitHub did not include the contents of ${file}.` };
  }
  return { ok: true, text: decodeGitHubContent(body.content, stringField(body.encoding) ?? "base64") };
}

function decodeGitHubContent(content: string, encoding: string): string {
  if (encoding === "base64") return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
  return content;
}

function githubHeaders(): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "SecureRepo",
    "x-github-api-version": "2022-11-28",
  };
}

function isSafeName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== "..";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
