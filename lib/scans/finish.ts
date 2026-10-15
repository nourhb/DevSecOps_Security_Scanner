import type { ScanRecord } from "@/lib/domain";
import { scannerWarnings } from "@/lib/domain";
import type { ScanResult } from "@/lib/scanner/types";
import { getStore } from "@/lib/store/json-store";

function isOpen(scan: ScanRecord): boolean {
  return scan.status === "pending" || scan.status === "running";
}

export async function markScanRunning(scanId: string): Promise<ScanRecord | undefined> {
  const store = getStore();
  const current = await store.getScan(scanId);
  if (!current || !isOpen(current)) return undefined;
  return store.updateScan(scanId, {
    status: "running",
    startedAt: current.startedAt ?? new Date().toISOString(),
  });
}

export async function failScan(scanId: string, message: string): Promise<ScanRecord | undefined> {
  const store = getStore();
  const current = await store.getScan(scanId);
  if (!current || !isOpen(current)) return undefined;
  return store.updateScan(scanId, {
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: message,
  });
}

/** Same completion rule as a local scan: empty findings plus a scanner error is a failure. */
export async function applyScannerResult(scanId: string, result: ScanResult): Promise<ScanRecord | undefined> {
  const store = getStore();
  const current = await store.getScan(scanId);
  if (!current || !isOpen(current)) return undefined;

  const incoming = scannerWarnings(result.errors);
  const warnings = [...current.warnings];
  for (const warning of incoming) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  if (result.findings.length === 0 && incoming.length > 0) {
    return store.updateScan(scanId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: incoming.join(" "),
      warnings,
      findings: [],
    });
  }

  return store.updateScan(scanId, {
    status: "completed",
    finishedAt: new Date().toISOString(),
    error: null,
    warnings,
    findings: result.findings,
  });
}
