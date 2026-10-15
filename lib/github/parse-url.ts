const HOSTS = new Set(["github.com", "www.github.com"]);
const NAME = /^[A-Za-z0-9_.-]+$/;

export type ParsedGitHubRepo = {
  owner: string;
  name: string;
  url: string;
};

export function parseGitHubRepoUrl(input: string): { ok: true; repo: ParsedGitHubRepo } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Enter a GitHub repository URL." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a full URL, including https://." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Use an http or https GitHub URL." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Remove credentials from the URL before adding it." };
  }
  if (!HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, error: "Only github.com repository URLs can be added." };
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return { ok: false, error: "The URL needs a GitHub owner and repository name." };
  }
  if (parts.length !== 2) {
    return { ok: false, error: "Paste the repository URL, not a file, issue, or pull request." };
  }

  const owner = parts[0];
  let name = parts[1];
  if (name.toLowerCase().endsWith(".git")) name = name.slice(0, -4);
  if (!isGitHubName(owner) || !isGitHubName(name)) {
    return { ok: false, error: "That owner or repository name is not valid on GitHub." };
  }

  return {
    ok: true,
    repo: {
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
    },
  };
}

export function sameGitHubRepo(left: Pick<ParsedGitHubRepo, "owner" | "name">, right: Pick<ParsedGitHubRepo, "owner" | "name">): boolean {
  return left.owner.toLowerCase() === right.owner.toLowerCase() && left.name.toLowerCase() === right.name.toLowerCase();
}

function isGitHubName(value: string): boolean {
  return NAME.test(value) && value !== "." && value !== ".." && !value.startsWith(".") && !value.endsWith(".");
}
