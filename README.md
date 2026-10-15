# SecureRepo

SecureRepo is a DevSecOps scanner. This slice scans npm dependencies and shows the results in the browser.

The scanner in `lib/scanner` does not depend on the UI. It reads `package.json` and, when present, `package-lock.json`. It runs `npm audit --json`, queries the [OSV API](https://api.osv.dev/v1/query) for each installed package version, and deduplicates records that describe the same vulnerability for the same package and version. A missing severity becomes `UNKNOWN`. A CVSS score is included only when a source provided a number. Directory paths are passed as the working directory of `npm`, never interpolated into a shell command.

## Screens

- **Dashboard** (`/`) shows total findings, the critical and high count, packages affected, and the last scan time and status.
- **Repositories** (`/repos`) adds a public `github.com` URL. The same repository cannot be saved twice. The clean and vulnerable fixtures can be scanned from this page.
- **Repository** (`/repos/[id]`) starts a scan and lists earlier runs.
- **Scan** (`/scans/[id]`) shows Pending, Running, Completed, or Failed. For a GitHub repository, the scan downloads `package.json` and `package-lock.json` from the public GitHub API, writes them to a temporary directory, and runs the scanner. The findings table lists package, version, vulnerability id, severity, fixed version, and source. Filters cover severity, package, vulnerability id, and status (new, still open, fixed).
- When a repository has two completed scans, the later scan marks a finding **fixed** only if that vulnerability id is no longer present on that package. The other rows are **new** or **still open**.
- Finished scans can be downloaded as JSON or PDF. The PDF includes the repository, date, status, summary, findings, and fix advice.

Saved repositories and scans live in `data/store.json`. That file is local and gitignored. GitHub Actions and a hosted Postgres database come next.

## Install

```bash
npm install
```

## Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To bind a specific host and port:

```bash
npm run dev -- --hostname 0.0.0.0 --port 43123
```

Opening that server at `http://127.0.0.1:43123` is allowed in `next.config.ts` (`allowedDevOrigins`). Add any other dev host there. If the host is blocked, the pages stay on their loading message because the browser cannot connect to the dev runtime.

## Run the tests

```bash
npm test
```

The vulnerable-fixture test runs `npm audit` and calls the OSV API, so it needs network access. Assertions check the shape of real findings and do not hard-code advisory ids.
