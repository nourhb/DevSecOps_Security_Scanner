import { connection } from "next/server";

import { buildReport, previousCompletedScan } from "@/lib/domain";
import { jsonError } from "@/lib/http";
import { renderScanPdf } from "@/lib/reports/pdf";
import { getStore } from "@/lib/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "json" && format !== "pdf") {
    return jsonError("Choose a JSON or PDF download.", 400);
  }

  const store = getStore();
  const scan = await store.getScan(id);
  if (!scan) return jsonError("That scan does not exist.", 404);
  if (scan.status === "pending" || scan.status === "running") {
    return jsonError("The scan is still running. Download the report after it finishes.", 409);
  }
  const repository = await store.getRepository(scan.repositoryId);
  if (!repository) return jsonError("The repository for this scan is missing.", 404);

  const previous = previousCompletedScan(await store.listScans(), scan);
  const report = buildReport(repository, scan, previous);
  const filename = `securerepo-${repository.owner}-${repository.name}-${scan.id.slice(0, 8)}.${format}`;

  if (format === "json") {
    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  }

  const pdf = await renderScanPdf(report);
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
