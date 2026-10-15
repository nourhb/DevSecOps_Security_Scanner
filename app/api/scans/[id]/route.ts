import { connection } from "next/server";

import { buildReport, previousCompletedScan } from "@/lib/domain";
import { jsonError, jsonOk } from "@/lib/http";
import { getStore } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await context.params;
  const store = getStore();
  const scan = await store.getScan(id);
  if (!scan) return jsonError("That scan does not exist.", 404);
  const repository = await store.getRepository(scan.repositoryId);
  if (!repository) return jsonError("The repository for this scan is missing.", 404);
  const previous = previousCompletedScan(await store.listScans(), scan);
  return jsonOk({ report: buildReport(repository, scan, previous) });
}
