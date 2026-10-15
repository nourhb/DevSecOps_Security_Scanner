import { connection } from "next/server";

import { repositoryLabel } from "@/lib/domain";
import { jsonError, jsonOk } from "@/lib/http";
import { reconcileOrphans } from "@/lib/scans/runner";
import { getStore } from "@/lib/store/json-store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await context.params;
  await reconcileOrphans();
  const store = getStore();
  const repository = await store.getRepository(id);
  if (!repository) return jsonError("That repository is not saved.", 404);
  const scans = (await store.listScans()).filter((scan) => scan.repositoryId === repository.id);
  return jsonOk({
    repository: { ...repository, label: repositoryLabel(repository) },
    scans: scans.map((scan) => ({
      id: scan.id,
      status: scan.status,
      createdAt: scan.createdAt,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      error: scan.error,
      findingCount: scan.findings.length,
      runner: scan.runner ?? "local",
    })),
  });
}
