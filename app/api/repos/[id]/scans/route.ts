import { jsonError, jsonOk } from "@/lib/http";
import { startRepositoryScan } from "@/lib/scans/runner";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await startRepositoryScan(id);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({ scan: result.scan }, 201);
}
