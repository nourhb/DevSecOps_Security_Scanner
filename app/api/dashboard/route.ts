import { connection } from "next/server";

import { repositoryLabel, summarize } from "@/lib/domain";
import { jsonOk } from "@/lib/http";
import { reconcileOrphans } from "@/lib/scans/runner";
import { getStore } from "@/lib/store/json-store";

export async function GET() {
  await connection();
  await reconcileOrphans();
  const store = getStore();
  const [repositories, scans] = await Promise.all([store.listRepositories(), store.listScans()]);
  const summary = summarize(repositories, scans);
  const reposById = new Map(repositories.map((repository) => [repository.id, repository]));
  return jsonOk({
    totalFindings: summary.totalFindings,
    criticalHigh: summary.criticalHigh,
    packagesAffected: summary.packagesAffected,
    repositoryCount: summary.repositoryCount,
    lastScan: summary.lastScan
      ? {
          id: summary.lastScan.id,
          status: summary.lastScan.status,
          createdAt: summary.lastScan.createdAt,
          finishedAt: summary.lastScan.finishedAt,
          repositoryId: summary.lastScan.repositoryId,
          repositoryLabel: reposById.has(summary.lastScan.repositoryId)
            ? repositoryLabel(reposById.get(summary.lastScan.repositoryId)!)
            : "Unknown repository",
        }
      : null,
    recentScans: scans.slice(0, 8).map((scan) => ({
      id: scan.id,
      status: scan.status,
      createdAt: scan.createdAt,
      finishedAt: scan.finishedAt,
      findingCount: scan.findings.length,
      repositoryId: scan.repositoryId,
      repositoryLabel: reposById.has(scan.repositoryId)
        ? repositoryLabel(reposById.get(scan.repositoryId)!)
        : "Unknown repository",
    })),
  });
}
