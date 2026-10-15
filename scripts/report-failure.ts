import { postScanUpdate } from "../lib/scans/callback";

const posted = await postScanUpdate({
  callbackUrl: process.env.CALLBACK_URL ?? "",
  scanId: process.env.SCAN_ID ?? "",
  secret: process.env.SECUREREPO_CALLBACK_SECRET ?? "",
  body: { status: "failed", error: "The GitHub Actions workflow failed before findings were posted." },
});

if (!posted.ok) {
  console.error(posted.message);
  process.exit(1);
}
