# SecureRepo

SecureRepo is a DevSecOps scanner. This slice scans npm dependencies and shows the results in the browser.

The scanner in `lib/scanner` does not depend on the UI. It reads `package.json` and, when present, `package-lock.json`. It runs `npm audit --json`, queries the [OSV API](https://api.osv.dev/v1/query) for each installed package version, and deduplicates records that describe the same vulnerability for the same package and version. A missing severity becomes `UNKNOWN`. A CVSS score is included only when a source provided a number. Directory paths are passed as the working directory of `npm`, never interpolated into a shell command.

## Portfolio

### Architecture

The browser talks only to Next.js route handlers. Those handlers call `lib/scans`, which is the only place that starts work. `lib/scanner` reads a directory and returns findings. It does not import the UI, Prisma, or GitHub. `lib/store` is the only module that writes PostgreSQL, through Prisma models `Repository`, `Scan`, `VulnerabilityFinding`, and `Remediation`.

```text
Browser
  → app/api (dashboard, repos, scans, reports, callback)
    → lib/scans (pending row, then local run or Actions dispatch)
      → lib/scanner (npm audit + OSV, normalized findings)
        → lib/store (Prisma)
          → PostgreSQL
```

### From the UI to the scanner to PostgreSQL

1. The repositories page posts a `github.com` URL to `POST /api/repos`. The URL is parsed and stored as a `Repository` row. The same owner and name cannot be saved twice.
2. **Start scan** on a repository page calls `POST /api/repos/[id]/scans`. The app inserts a `Scan` with status `pending` and runner `local`. A second scan is refused while one is pending or running.
3. The job marks the scan `running`. For a GitHub repository it downloads `package.json` and, when present, `package-lock.json` from the public GitHub contents API and writes them to a temporary directory. A fixture scan uses `fixtures/clean` or `fixtures/vulnerable` on disk. No user string is passed to a shell.
4. `scanDirectory` runs `npm audit --json` with `shell: false` and queries the OSV API. It returns one list of findings plus any structured errors.
5. If the scan produced findings, the app sets status `completed` and writes `VulnerabilityFinding` and `Remediation` rows. If there are no findings and the scanner reported errors, the scan is `failed` and the error is stored on the scan. The temporary directory is removed either way.
6. The scan page polls `GET /api/scans/[id]`. Finished scans can be downloaded as JSON or PDF built from those rows. The dashboard reads the latest completed scan for each repository.

### GitHub Actions

**Run GitHub Actions scan** calls `POST /api/repos/[id]/actions`. The app inserts a pending scan with runner `actions`, then tries to dispatch `.github/workflows/security-scan.yml` with `workflow_dispatch` inputs `repository`, `scan_id`, and `callback_url`.

The workflow checks out this repository, installs dependencies, resolves the public URL to an `owner/name` slug, checks that repository out with `persist-credentials: false`, and runs `scripts/report-scan.ts`. That script POSTs `running`, then the normalized findings, to `POST /api/scans/<scan id>/results`. If the job fails first, `scripts/report-failure.ts` POSTs `failed`. The callback handler writes the same finding and remediation rows as a local scan.

User values travel only as environment variables. The `run:` lines are fixed scripts and do not interpolate those values.

### Limits

- Saved GitHub repositories must be public `github.com` npm projects. The scanner reads `package.json` and an optional `package-lock.json` from the default branch. A repository with no `package.json` fails. Private repositories, other forges, and non-npm manifests are out of scope. The clean and vulnerable fixtures are local directories, not GitHub checkouts.
- A real Actions run posts findings back to this app, so `SECUREREPO_CALLBACK_URL` must be a public URL GitHub's runners can reach. Localhost, loopback, `.local`, and private addresses are rejected. In that case, and when `SECUREREPO_GITHUB_TOKEN` is unset or the dispatch request fails, the same scanner runs in this process and the scan page says so. The workflow file is still valid.

### Security

- Repository URLs must be `http` or `https` on `github.com` or `www.github.com`, with an owner and a repository name and no embedded credentials. Extra path segments, other hosts, and unsafe names are rejected before any request is made.
- The Actions callback requires `Authorization: Bearer` matching `SECUREREPO_CALLBACK_SECRET`. The comparison uses a SHA-256 digest and `timingSafeEqual`. A missing secret returns 503. A wrong secret returns 401. The name is listed in `.env.example`. The value stays in a local `.env` and in the GitHub Actions secret store.
- JSON and PDF reports contain the repository, date, status, summary, findings, and fix advice. They do not include `SECUREREPO_CALLBACK_SECRET`, `SECUREREPO_GITHUB_TOKEN`, or the database password.

## Screens

- **Dashboard** (`/`) shows total findings, the critical and high count, packages affected, and the last scan time and status.
- **Repositories** (`/repos`) adds a public `github.com` URL. The same repository cannot be saved twice. The clean and vulnerable fixtures can be scanned from this page.
- **Repository** (`/repos/[id]`) starts a scan and lists earlier runs. **Run GitHub Actions scan** dispatches `.github/workflows/security-scan.yml` for a public GitHub repository. If Actions cannot be dispatched, the same scanner runs in the app and the page still shows Pending, Running, Completed, or Failed.
- **Scan** (`/scans/[id]`) shows Pending, Running, Completed, or Failed, and whether the run is GitHub Actions or this app. For a GitHub repository, a local scan downloads `package.json` and `package-lock.json` from the public GitHub API, writes them to a temporary directory, and runs the scanner. The findings table lists package, version, vulnerability id, severity, fixed version, and source. Filters cover severity, package, vulnerability id, and status (new, still open, fixed).
- When a repository has two completed scans, the later scan marks a finding **fixed** only if that vulnerability id is no longer present on that package. The other rows are **new** or **still open**.
- Finished scans can be downloaded as JSON or PDF. The PDF includes the repository, date, status, summary, findings, and fix advice.

Saved repositories, scans, findings, and remediation advice live in PostgreSQL through Prisma. The models are `Repository`, `Scan`, `VulnerabilityFinding`, and `Remediation`.

## Database

Copy `.env.example` to `.env` and set `DATABASE_URL` plus `POSTGRES_PASSWORD`. Do not commit `.env`.

```bash
docker compose up -d
npx prisma migrate deploy
```

`docker-compose.yml` starts Postgres and reads the password from the environment. There is no seed script.

## GitHub Actions

`.github/workflows/security-scan.yml` runs when someone dispatches it with a public repository URL, a scan id, and this app's base URL. The workflow checks out that repository, runs the scanner in `lib/scanner`, and POSTs the normalized findings to `/api/scans/<scan id>/results`. The request uses `Authorization: Bearer` with `SECUREREPO_CALLBACK_SECRET`. Put that name in the GitHub Actions secret store and in a local `.env` copied from `.env.example`. Do not commit the value.

From a repository page, choose **Run GitHub Actions scan**. The app dispatches the workflow when `SECUREREPO_GITHUB_TOKEN` is set and `SECUREREPO_CALLBACK_URL` is a public URL GitHub can reach. Otherwise it runs the scanner in this process and says so on the scan page.

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

The vulnerable-fixture test runs `npm audit` and calls the OSV API, so it needs network access. Store tests use the `DATABASE_URL` database with `_test` appended to the name, so apply migrations there too. Assertions check the shape of real findings and do not hard-code advisory ids.
