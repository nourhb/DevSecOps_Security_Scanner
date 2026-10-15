import { scanDirectory } from "../lib/scanner/scan";
import { postScanUpdate } from "../lib/scans/callback";

const targetDir = process.env.TARGET_DIR ?? "";
const scanId = process.env.SCAN_ID ?? "";
const callbackUrl = process.env.CALLBACK_URL ?? "";
const secret = process.env.SECUREREPO_CALLBACK_SECRET ?? "";

if (!targetDir || targetDir.includes("\n") || targetDir.includes("\0")) {
  console.error("TARGET_DIR is missing.");
  process.exit(1);
}

const running = await postScanUpdate({
  callbackUrl,
  scanId,
  secret,
  body: { status: "running" },
});
if (!running.ok) {
  console.error(running.message);
  process.exit(1);
}

try {
  const result = await scanDirectory(targetDir);
  const posted = await postScanUpdate({
    callbackUrl,
    scanId,
    secret,
    body: { status: "completed", findings: result.findings, errors: result.errors },
  });
  if (!posted.ok) {
    console.error(posted.message);
    process.exit(1);
  }
} catch (error) {
  const message = error instanceof Error && error.message ? error.message.slice(0, 500) : "The scanner failed.";
  await postScanUpdate({
    callbackUrl,
    scanId,
    secret,
    body: { status: "failed", error: message },
  });
  console.error(message);
  process.exit(1);
}
