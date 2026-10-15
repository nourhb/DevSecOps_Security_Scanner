import { jsonError, jsonOk } from "@/lib/http";
import { startActionsScan } from "@/lib/scans/runner";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const configured = process.env.SECUREREPO_CALLBACK_URL?.trim();
  const callbackUrl = configured || new URL(request.url).origin;
  const result = await startActionsScan(id, { callbackUrl });
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({ scan: result.scan }, 201);
}
