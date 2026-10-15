import { createHash, timingSafeEqual } from "node:crypto";

import type { ScanRecord } from "@/lib/domain";
import { SEVERITIES, type Finding, type ScanError, type ScanErrorSource, type ScanResult, type Severity } from "@/lib/scanner/types";
import { applyScannerResult, failScan, markScanRunning } from "@/lib/scans/finish";
import { releaseScanJob } from "@/lib/scans/jobs";
import { getStore } from "@/lib/store/json-store";

const ERROR_SOURCES: ScanErrorSource[] = ["npm-audit", "osv", "input"];
const MAX_FINDINGS = 5000;

export type CallbackBody = {
  status: "running" | "completed" | "failed";
  findings?: Finding[];
  errors?: ScanError[];
  error?: string | null;
};

export function callbackSecret(env: Env = process.env): string | null {
  const value = env.SECUREREPO_CALLBACK_SECRET?.trim();
  return value ? value : null;
}

export function authorizeCallback(header: string | null, env: Env = process.env): boolean {
  const secret = callbackSecret(env);
  if (!secret || !header) return false;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) return false;
  const provided = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(provided, expected);
}

export function parseCallbackBody(input: unknown): { ok: true; body: CallbackBody } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "Send a JSON object." };
  if (input.status !== "running" && input.status !== "completed" && input.status !== "failed") {
    return { ok: false, error: "Status must be running, completed, or failed." };
  }

  if (input.status === "running") return { ok: true, body: { status: "running" } };

  const findings = parseFindings(input.findings);
  if (!findings.ok) return findings;
  const errors = parseErrors(input.errors);
  if (!errors.ok) return errors;
  const error = parseOptionalMessage(input.error);
  if (!error.ok) return error;

  if (input.status === "failed" && !error.value && errors.value.length === 0) {
    return { ok: false, error: "A failed scan needs an error message." };
  }

  return {
    ok: true,
    body: {
      status: input.status,
      findings: findings.value,
      errors: errors.value,
      error: error.value,
    },
  };
}

export function callbackEndpoint(callbackUrl: string, scanId: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) return null;
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  url.pathname = `/api/scans/${scanId}/results`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isPublicCallbackUrl(callbackUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  return !isLocalHost(url.hostname);
}

export async function postScanUpdate(options: {
  callbackUrl: string;
  scanId: string;
  secret: string;
  body: CallbackBody;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const endpoint = callbackEndpoint(options.callbackUrl, options.scanId);
  if (!endpoint) return { ok: false, message: "The callback URL or scan id is not valid." };
  if (!options.secret) return { ok: false, message: "SECUREREPO_CALLBACK_SECRET is not set." };

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.secret}`,
        "content-type": "application/json",
        "user-agent": "SecureRepo",
      },
      body: JSON.stringify(options.body),
    });
  } catch {
    return { ok: false, message: "The callback request failed." };
  }
  if (response.ok || response.status === 409) return { ok: true };
  return { ok: false, message: `The app returned HTTP ${response.status}.` };
}

export async function acceptScanCallback(
  scanId: string,
  authorization: string | null,
  input: unknown,
  env: Env = process.env,
): Promise<{ ok: true; scan: ScanRecord } | { ok: false; error: string; status: number }> {
  if (!callbackSecret(env)) {
    return { ok: false, error: "The callback secret is not configured.", status: 503 };
  }
  if (!authorizeCallback(authorization, env)) {
    return { ok: false, error: "The callback secret does not match.", status: 401 };
  }

  const parsed = parseCallbackBody(input);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const existing = await getStore().getScan(scanId);
  if (!existing) return { ok: false, error: "That scan does not exist.", status: 404 };
  if (existing.status !== "pending" && existing.status !== "running") {
    return { ok: false, error: "That scan has already finished.", status: 409 };
  }

  const scan = await applyCallback(scanId, parsed.body);
  if (!scan) return { ok: false, error: "That scan has already finished.", status: 409 };
  if (scan.status === "completed" || scan.status === "failed") releaseScanJob(scanId);
  return { ok: true, scan };
}

async function applyCallback(scanId: string, body: CallbackBody): Promise<ScanRecord | undefined> {
  if (body.status === "running") return markScanRunning(scanId);
  if (body.status === "failed") {
    const message = body.error?.trim() || body.errors?.map((error) => error.message).join(" ") || "The scan failed.";
    return failScan(scanId, message);
  }
  const result: ScanResult = { findings: body.findings ?? [], errors: body.errors ?? [] };
  return applyScannerResult(scanId, result);
}

function parseFindings(input: unknown): { ok: true; value: Finding[] } | { ok: false; error: string } {
  if (input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: "Findings must be a list." };
  if (input.length > MAX_FINDINGS) return { ok: false, error: "Too many findings." };
  const findings: Finding[] = [];
  for (const item of input) {
    const finding = parseFinding(item);
    if (!finding.ok) return finding;
    findings.push(finding.value);
  }
  return { ok: true, value: findings };
}

function parseFinding(input: unknown): { ok: true; value: Finding } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "Each finding must be an object." };
  const packageName = shortText(input.packageName, 214);
  const installedVersion = shortText(input.installedVersion, 100);
  const vulnerabilityId = shortText(input.vulnerabilityId, 100);
  if (!packageName || !installedVersion || !vulnerabilityId) {
    return { ok: false, error: "Each finding needs a package, version, and vulnerability id." };
  }
  if (!isSeverity(input.severity)) {
    return { ok: false, error: "A finding severity is not recognized." };
  }
  if (input.source !== "npm-audit" && input.source !== "osv") {
    return { ok: false, error: "A finding source must be npm-audit or osv." };
  }

  const finding: Finding = {
    packageName,
    installedVersion,
    vulnerabilityId,
    severity: input.severity,
    source: input.source,
  };
  if (input.cvssScore !== undefined) {
    if (typeof input.cvssScore !== "number" || !Number.isFinite(input.cvssScore)) {
      return { ok: false, error: "A CVSS score must be a number." };
    }
    finding.cvssScore = input.cvssScore;
  }
  if (input.fixedVersion !== undefined) {
    const fixedVersion = shortText(input.fixedVersion, 100);
    if (!fixedVersion) return { ok: false, error: "A fixed version must be text." };
    finding.fixedVersion = fixedVersion;
  }
  return { ok: true, value: finding };
}

function parseErrors(input: unknown): { ok: true; value: ScanError[] } | { ok: false; error: string } {
  if (input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: "Errors must be a list." };
  const errors: ScanError[] = [];
  for (const item of input) {
    if (!isRecord(item) || !isErrorSource(item.source)) {
      return { ok: false, error: "An error source is not recognized." };
    }
    const message = shortText(item.message, 500);
    if (!message) return { ok: false, error: "An error needs a message." };
    errors.push({ source: item.source, message });
  }
  return { ok: true, value: errors };
}

function parseOptionalMessage(input: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: null };
  const message = shortText(input, 500);
  if (!message) return { ok: false, error: "The error message must be text." };
  return { ok: true, value: message };
}

function shortText(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const parts = v4.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 169 && b === 254)) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  return false;
}

type Env = Record<string, string | undefined>;

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && SEVERITIES.some((severity) => severity === value);
}

function isErrorSource(value: unknown): value is ScanErrorSource {
  return typeof value === "string" && ERROR_SOURCES.some((source) => source === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
