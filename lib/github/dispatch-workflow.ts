import type { FetchLike } from "@/lib/scanner/types";

export type WorkflowDispatchInput = {
  repositoryUrl: string;
  scanId: string;
  callbackUrl: string;
};

const NAME = /^[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9._/-]+$/;

export async function dispatchSecurityScan(
  input: WorkflowDispatchInput,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = env.SECUREREPO_GITHUB_TOKEN?.trim();
  if (!token) return { ok: false, message: "SECUREREPO_GITHUB_TOKEN is not set" };

  const slug = parseActionsRepo(env.SECUREREPO_ACTIONS_REPO ?? "nourhb/DevSecOps_Security_Scanner");
  if (!slug) return { ok: false, message: "SECUREREPO_ACTIONS_REPO is not a valid owner/name" };

  const ref = env.SECUREREPO_ACTIONS_REF?.trim() || "main";
  if (!REF.test(ref)) return { ok: false, message: "SECUREREPO_ACTIONS_REF is not a valid git ref" };

  const url = `https://api.github.com/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.name)}/actions/workflows/security-scan.yml/dispatches`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "SecureRepo",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({
        ref,
        inputs: {
          repository: input.repositoryUrl,
          scan_id: input.scanId,
          callback_url: input.callbackUrl,
        },
      }),
    });
  } catch {
    return { ok: false, message: "the GitHub API could not be reached" };
  }

  if (response.status === 204) return { ok: true };
  return { ok: false, message: `GitHub returned HTTP ${response.status}` };
}

function parseActionsRepo(value: string): { owner: string; name: string } | null {
  const [owner, name, extra] = value.split("/");
  if (!owner || !name || extra !== undefined) return null;
  if (!NAME.test(owner) || !NAME.test(name) || owner.startsWith(".") || name.startsWith(".")) return null;
  return { owner, name };
}
