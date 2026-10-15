import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { findingStatusLabel, formatWhen, type ScanReport } from "@/lib/domain";

export async function renderScanPdf(report: ScanReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const pageWidth = 612;
  const pageHeight = 792;
  const contentWidth = pageWidth - margin * 2;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const ensure = (height: number) => {
    if (y - height < margin) newPage();
  };

  const write = (text: string, size: number, weight: "regular" | "bold" = "regular") => {
    const face = weight === "bold" ? bold : font;
    const lines = wrap(text, face, size, contentWidth);
    for (const line of lines) {
      ensure(size + 4);
      page.drawText(line, { x: margin, y: y - size, size, font: face, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
    }
  };

  write("SecureRepo scan report", 18, "bold");
  y -= 6;
  write(report.repository.label, 14, "bold");
  if (report.repository.url) write(report.repository.url, 10);
  write(`Status: ${report.scan.statusLabel}`, 11);
  write(`Started: ${formatWhen(report.scan.startedAt ?? report.scan.createdAt)}`, 11);
  write(`Finished: ${formatWhen(report.scan.finishedAt)}`, 11);
  if (report.scan.error) write(`Error: ${report.scan.error}`, 11);
  y -= 8;

  write("Summary", 13, "bold");
  write(`Findings: ${report.summary.totalFindings}`, 11);
  write(`Critical and high: ${report.summary.criticalHigh}`, 11);
  write(`Packages affected: ${report.summary.packagesAffected}`, 11);
  write(
    `By severity: ${report.summary.bySeverity.CRITICAL} critical, ${report.summary.bySeverity.HIGH} high, ${report.summary.bySeverity.MEDIUM} medium, ${report.summary.bySeverity.LOW} low, ${report.summary.bySeverity.UNKNOWN} unknown`,
    11,
  );
  if (report.comparison) {
    write(
      `Compared with the previous scan: ${report.comparison.new} new, ${report.comparison.open} still open, ${report.comparison.fixed} fixed.`,
      11,
    );
  }
  y -= 8;

  write("Findings", 13, "bold");
  if (report.findings.length === 0) {
    write("This scan did not report any vulnerabilities.", 11);
  } else {
    for (const finding of report.findings) {
      const score = finding.cvssScore === undefined ? "" : `, CVSS ${finding.cvssScore}`;
      const fixed = finding.fixedVersion ? `, fixed in ${finding.fixedVersion}` : ", no fixed version reported";
      write(
        `${finding.packageName}@${finding.installedVersion} — ${finding.vulnerabilityId} — ${finding.severity}${score}${fixed} — ${findingStatusLabel(finding.status)} — ${finding.source === "npm-audit" ? "npm audit" : "OSV"}`,
        10,
      );
    }
  }
  y -= 8;

  write("What to do next", 13, "bold");
  if (report.fixAdvice.length === 0) {
    write("Nothing to upgrade. This scan did not report vulnerabilities.", 11);
  } else {
    for (const line of report.fixAdvice) write(line, 10);
  }

  const pages = doc.getPages();
  pages.forEach((item, index) => {
    item.drawText(`SecureRepo  ${index + 1} / ${pages.length}`, {
      x: margin,
      y: 24,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  return doc.save();
}

function wrap(text: string, font: { widthOfTextAtSize: (value: string, size: number) => number }, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const next = `${current} ${word}`;
    if (font.widthOfTextAtSize(next, size) <= width) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}
