import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch {
  // Scanner tests do not need a database. Store tests fail with a clear error if DATABASE_URL is missing.
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  const name = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "securerepo";
  if (!name.endsWith("_test")) parsed.pathname = `/${name}_test`;
  process.env.DATABASE_URL = parsed.toString();
}
