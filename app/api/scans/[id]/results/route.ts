import { acceptScanCallback } from "@/lib/scans/callback";
import { jsonError, jsonOk } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const result = await acceptScanCallback(id, request.headers.get("authorization"), body);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({ scan: result.scan });
}
