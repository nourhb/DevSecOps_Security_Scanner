const GHSA = /^GHSA-([0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$/i;
const CVE = /^CVE-(\d{4}-\d{4,})$/i;

export function canonicalVulnerabilityId(id: string): string {
  const ghsa = GHSA.exec(id.trim());
  if (ghsa) return `GHSA-${ghsa[1].toLowerCase()}`;
  const cve = CVE.exec(id.trim());
  if (cve) return `CVE-${cve[1]}`;
  return id.trim();
}

export function idsOverlap(left: Iterable<string>, right: Iterable<string>): boolean {
  const known = new Set<string>();
  for (const id of left) known.add(canonicalVulnerabilityId(id));
  for (const id of right) {
    if (known.has(canonicalVulnerabilityId(id))) return true;
  }
  return false;
}

export function preferredVulnerabilityId(ids: Iterable<string>): string {
  const unique = [...new Set([...ids].map(canonicalVulnerabilityId).filter((id) => id.length > 0))];
  return (
    unique.find((id) => id.startsWith("GHSA-")) ??
    unique.find((id) => id.startsWith("CVE-")) ??
    unique[0] ??
    "unknown"
  );
}
