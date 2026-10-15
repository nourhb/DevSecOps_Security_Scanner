import { jsonError, jsonOk } from "@/lib/http";
import { startFixtureScan } from "@/lib/scans/runner";

export async function POST(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const result = await startFixtureScan(name);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({ scan: result.scan }, 201);
}
