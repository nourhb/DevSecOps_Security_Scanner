import { canonicalVulnerabilityId } from "@/lib/scanner/ids";
import { severityRank } from "@/lib/scanner/severity";
import type { DraftFinding, Finding } from "@/lib/scanner/types";

const SEVERITY_SORT = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
} as const;

/**
 * Collapse an OSV record into the npm audit advisory with the same id.
 * Two npm advisories stay separate even when OSV lists one GHSA as an alias of another.
 */
export function dedupeFindings(drafts: DraftFinding[]): Finding[] {
  const audits = collapseByPrimaryId(drafts.filter((draft) => draft.source === "npm-audit"));
  const osvs = collapseByPrimaryId(drafts.filter((draft) => draft.source === "osv"));
  const grouped = new Map<number, DraftFinding[]>();
  const consumed = new Set<number>();

  osvs.forEach((osv, index) => {
    const match = matchingAuditIndex(osv, audits, (audit) => primaryId(audit) === primaryId(osv));
    if (match === undefined) return;
    pushGroup(grouped, match, osv);
    consumed.add(index);
  });

  osvs.forEach((osv, index) => {
    if (consumed.has(index)) return;
    const match = matchingAuditIndex(osv, audits, (audit) => sharesIdentifier(audit, osv));
    if (match === undefined) return;
    pushGroup(grouped, match, osv);
    consumed.add(index);
  });

  const findings = audits.map((audit, index) => toFinding(mergeDrafts([audit, ...(grouped.get(index) ?? [])]), "npm-audit"));
  osvs.forEach((osv, index) => {
    if (!consumed.has(index)) findings.push(toFinding(osv, "osv"));
  });

  return findings.sort(compareFindings);
}

function matchingAuditIndex(
  osv: DraftFinding,
  audits: DraftFinding[],
  predicate: (audit: DraftFinding) => boolean,
): number | undefined {
  const index = audits.findIndex(
    (audit) => samePackageVersion(audit, osv) && predicate(audit),
  );
  return index === -1 ? undefined : index;
}

function collapseByPrimaryId(drafts: DraftFinding[]): DraftFinding[] {
  const groups = new Map<string, DraftFinding[]>();
  for (const draft of drafts) {
    const key = `${draft.packageName}\0${draft.installedVersion}\0${primaryId(draft)}`;
    const group = groups.get(key) ?? [];
    group.push(draft);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => mergeDrafts(group));
}

function mergeDrafts(group: DraftFinding[], source: DraftFinding["source"] = group[0].source): DraftFinding {
  const severity = group.reduce(
    (best, draft) => (severityRank(draft.severity) > severityRank(best) ? draft.severity : best),
    group[0].severity,
  );
  const cvssScore = group.find((draft) => draft.source === "npm-audit" && draft.cvssScore !== undefined)?.cvssScore
    ?? group.find((draft) => draft.cvssScore !== undefined)?.cvssScore;
  const fixedVersion = group.find((draft) => draft.fixedVersion)?.fixedVersion;
  const fallbackFixedVersion = group.find((draft) => draft.fallbackFixedVersion)?.fallbackFixedVersion;
  const merged: DraftFinding = {
    packageName: group[0].packageName,
    installedVersion: group[0].installedVersion,
    vulnerabilityId: preferredId(group),
    severity,
    source,
    aliases: [...new Set(group.flatMap((draft) => [draft.vulnerabilityId, ...draft.aliases].map(canonicalVulnerabilityId)))],
  };
  if (cvssScore !== undefined) merged.cvssScore = cvssScore;
  if (fixedVersion) merged.fixedVersion = fixedVersion;
  if (fallbackFixedVersion) merged.fallbackFixedVersion = fallbackFixedVersion;
  return merged;
}

function toFinding(draft: DraftFinding, source: DraftFinding["source"]): Finding {
  const fixedVersion = draft.fixedVersion ?? draft.fallbackFixedVersion;
  const finding: Finding = {
    packageName: draft.packageName,
    installedVersion: draft.installedVersion,
    vulnerabilityId: draft.vulnerabilityId,
    severity: draft.severity,
    source,
  };
  if (draft.cvssScore !== undefined) finding.cvssScore = draft.cvssScore;
  if (fixedVersion) finding.fixedVersion = fixedVersion;
  return finding;
}

function preferredId(group: DraftFinding[]): string {
  const npmId = group.find((draft) => draft.source === "npm-audit")?.vulnerabilityId;
  if (npmId) return canonicalVulnerabilityId(npmId);
  const ids = group.flatMap((draft) => [draft.vulnerabilityId, ...draft.aliases]);
  return (
    ids.map(canonicalVulnerabilityId).find((id) => id.startsWith("GHSA-")) ??
    ids.map(canonicalVulnerabilityId).find((id) => id.startsWith("CVE-")) ??
    canonicalVulnerabilityId(group[0].vulnerabilityId)
  );
}

function sharesIdentifier(audit: DraftFinding, osv: DraftFinding): boolean {
  const auditIds = new Set([audit.vulnerabilityId, ...audit.aliases].map(canonicalVulnerabilityId));
  return [osv.vulnerabilityId, ...osv.aliases].some((id) => auditIds.has(canonicalVulnerabilityId(id)));
}

function primaryId(draft: DraftFinding): string {
  return canonicalVulnerabilityId(draft.vulnerabilityId);
}

function samePackageVersion(left: DraftFinding, right: DraftFinding): boolean {
  return left.packageName === right.packageName && left.installedVersion === right.installedVersion;
}

function pushGroup(groups: Map<number, DraftFinding[]>, index: number, draft: DraftFinding) {
  const group = groups.get(index) ?? [];
  group.push(draft);
  groups.set(index, group);
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    SEVERITY_SORT[left.severity] - SEVERITY_SORT[right.severity] ||
    left.packageName.localeCompare(right.packageName) ||
    left.installedVersion.localeCompare(right.installedVersion) ||
    left.vulnerabilityId.localeCompare(right.vulnerabilityId)
  );
}
