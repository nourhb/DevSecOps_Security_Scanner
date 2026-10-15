import { appendFile } from "node:fs/promises";

import { parseGitHubRepoUrl } from "../lib/github/parse-url";

const parsed = parseGitHubRepoUrl(process.env.REPOSITORY_URL ?? "");
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}

const line = `slug=${parsed.repo.owner}/${parsed.repo.name}\n`;
const output = process.env.GITHUB_OUTPUT;
if (output) {
  await appendFile(output, line);
} else {
  process.stdout.write(line);
}
