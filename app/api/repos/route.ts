import { connection } from "next/server";

import { repositoryLabel } from "@/lib/domain";
import { jsonError, jsonOk } from "@/lib/http";
import { addGitHubRepository, reconcileOrphans } from "@/lib/scans/runner";
import { getStore } from "@/lib/store/json-store";

export async function GET() {
  await connection();
  await reconcileOrphans();
  const store = getStore();
  const [repositories, scans] = await Promise.all([store.listRepositories(), store.listScans()]);
  return jsonOk({
    repositories: repositories.map((repository) => ({
      ...repository,
      label: repositoryLabel(repository),
      scanCount: scans.filter((scan) => scan.repositoryId === repository.id).length,
      activeScan: scans.some(
        (scan) =>
          scan.repositoryId === repository.id && (scan.status === "pending" || scan.status === "running"),
      ),
    })),
  });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }
  const url = isRecord(payload) && typeof payload.url === "string" ? payload.url : "";
  const result = await addGitHubRepository(url);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({ repository: { ...result.repository, label: repositoryLabel(result.repository) } }, 201);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
