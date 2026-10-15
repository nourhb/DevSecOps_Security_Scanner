import { readFile } from "node:fs/promises";
import path from "node:path";

import type { InstalledPackage } from "@/lib/scanner/types";

export type PackageReadResult =
  | { ok: true; packages: InstalledPackage[] }
  | { ok: false; message: string };

type LockPackage = {
  name?: string;
  version?: string;
};

type PackageManifest = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
};

export async function readInstalledPackages(directory: string): Promise<PackageReadResult> {
  const manifest = await readJsonFile(path.join(directory, "package.json"));
  if (!manifest.ok) return manifest;
  if (!isRecord(manifest.value)) {
    return { ok: false, message: "package.json must contain a JSON object." };
  }

  const lockPath = path.join(directory, "package-lock.json");
  const lock = await readJsonFile(lockPath);
  if (lock.ok) {
    if (!isRecord(lock.value)) {
      return { ok: false, message: "package-lock.json must contain a JSON object." };
    }
    return { ok: true, packages: packagesFromLockfile(lock.value) };
  }

  if (lock.missing) {
    return { ok: true, packages: packagesFromManifest(manifest.value as PackageManifest) };
  }

  return { ok: false, message: lock.message };
}

function packagesFromLockfile(lock: Record<string, unknown>): InstalledPackage[] {
  const packages = isRecord(lock.packages) ? lock.packages : null;
  if (packages) {
    return uniquePackages(
      Object.entries(packages).flatMap(([lockPath, value]) => {
        if (lockPath === "" || !isRecord(value)) return [];
        const entry = value as LockPackage;
        const name = packageNameFromLockPath(lockPath, entry.name);
        const version = typeof entry.version === "string" ? entry.version : "";
        if (!name || !version) return [];
        return [{ name, version }];
      }),
    );
  }

  return uniquePackages(packagesFromLockV1(lock.dependencies));
}

function packagesFromLockV1(value: unknown): InstalledPackage[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([name, entry]) => {
    if (!isRecord(entry) || typeof entry.version !== "string") return [];
    return [{ name, version: entry.version }, ...packagesFromLockV1(entry.dependencies)];
  });
}

function packagesFromManifest(manifest: PackageManifest): InstalledPackage[] {
  const sections = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies];
  return uniquePackages(
    sections.flatMap((section) => {
      if (!section) return [];
      return Object.entries(section).flatMap(([name, spec]) => {
        const version = exactVersion(spec);
        return version ? [{ name, version }] : [];
      });
    }),
  );
}

function packageNameFromLockPath(lockPath: string, explicitName: string | undefined): string | null {
  if (explicitName && explicitName.trim()) return explicitName.trim();
  const parts = lockPath.split("node_modules/");
  const name = parts[parts.length - 1]?.replace(/\/$/, "");
  return name ? name : null;
}

function exactVersion(spec: unknown): string | null {
  if (typeof spec !== "string") return null;
  const trimmed = spec.trim();
  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed)) return trimmed;
  return null;
}

function uniquePackages(packages: InstalledPackage[]): InstalledPackage[] {
  const seen = new Set<string>();
  const unique: InstalledPackage[] = [];
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(pkg);
  }
  return unique;
}

async function readJsonFile(
  filePath: string,
): Promise<{ ok: true; value: unknown } | { ok: false; missing?: boolean; message: string }> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return { ok: false, missing: true, message: `${path.basename(filePath)} was not found.` };
    return { ok: false, message: `Could not read ${path.basename(filePath)}.` };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: `${path.basename(filePath)} is not valid JSON.` };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
