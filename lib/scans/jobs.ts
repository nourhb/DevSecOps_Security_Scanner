import { failScan } from "@/lib/scans/finish";

type JobGlobal = {
  active?: Set<string>;
  timers?: Map<string, ReturnType<typeof setTimeout>>;
};

function root(): JobGlobal {
  const globalRoot = globalThis as typeof globalThis & { __securerepoJobs?: JobGlobal };
  globalRoot.__securerepoJobs ??= {};
  globalRoot.__securerepoJobs.active ??= new Set();
  globalRoot.__securerepoJobs.timers ??= new Map();
  return globalRoot.__securerepoJobs;
}

export function activeJobs(): Set<string> {
  return root().active ?? new Set();
}

function timers(): Map<string, ReturnType<typeof setTimeout>> {
  return root().timers ?? new Map();
}

export function releaseScanJob(scanId: string): void {
  activeJobs().delete(scanId);
  const timer = timers().get(scanId);
  if (timer) clearTimeout(timer);
  timers().delete(scanId);
}

export function trackLocalScan(scanId: string): void {
  activeJobs().add(scanId);
}

export function trackActionsScan(scanId: string): void {
  activeJobs().add(scanId);
  const timer = setTimeout(() => {
    void failScan(scanId, "GitHub Actions did not report a result. Start the scan again.").finally(() => releaseScanJob(scanId));
  }, actionsTimeoutMs());
  timer.unref?.();
  timers().set(scanId, timer);
}

export function actionsTimeoutMs(): number {
  const raw = process.env.SECUREREPO_ACTIONS_TIMEOUT_MS;
  if (raw === undefined) return 20 * 60 * 1000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20 * 60 * 1000;
}
