import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { dedupeFindings } from "@/lib/scanner/normalize";
import { collectNpmFindings } from "@/lib/scanner/npm-audit";
import { collectOsvFindings } from "@/lib/scanner/osv";
import { readInstalledPackages } from "@/lib/scanner/packages";
import type { ScanOptions, ScanResult } from "@/lib/scanner/types";

export async function scanDirectory(directory: string, options: ScanOptions = {}): Promise<ScanResult> {
  try {
    const project = await resolveProjectDirectory(directory);
    if (!project.ok) return { findings: [], errors: [{ source: "input", message: project.message }] };

    const packages = await readInstalledPackages(project.directory);
    if (!packages.ok) return { findings: [], errors: [{ source: "input", message: packages.message }] };

    const [audit, osv] = await Promise.all([
      collectNpmFindings(project.directory, packages.packages),
      collectOsvFindings(packages.packages, options.fetchImpl ?? fetch),
    ]);

    return {
      findings: dedupeFindings([...audit.findings, ...osv.findings]),
      errors: [...audit.errors, ...osv.errors],
    };
  } catch (error) {
    return {
      findings: [],
      errors: [
        {
          source: "input",
          message: error instanceof Error && error.message ? error.message : "The scan failed.",
        },
      ],
    };
  }
}

async function resolveProjectDirectory(
  directory: string,
): Promise<{ ok: true; directory: string } | { ok: false; message: string }> {
  if (typeof directory !== "string" || directory.trim() === "") {
    return { ok: false, message: "A directory path is required." };
  }

  let resolved: string;
  try {
    resolved = await realpath(directory);
  } catch {
    return { ok: false, message: "The directory does not exist." };
  }

  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) return { ok: false, message: "The path is not a directory." };
  } catch {
    return { ok: false, message: "The directory does not exist." };
  }

  try {
    const manifest = await stat(path.join(resolved, "package.json"));
    if (!manifest.isFile()) return { ok: false, message: "package.json is not a file." };
  } catch {
    return { ok: false, message: "No package.json in the selected directory." };
  }

  return { ok: true, directory: resolved };
}
