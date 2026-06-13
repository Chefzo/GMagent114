// Loads environment configuration. Reads .env (if present) without a dependency,
// then exposes typed getters. Missing-but-required values fail loudly so the
// scheduled job never silently runs half-configured.

import { readFileSync, existsSync } from "node:fs";
import { log } from "./logger.ts";

function loadDotEnv(): void {
  const path = ".env";
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

export function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

export function requireEnv(key: string): string {
  const v = env(key);
  if (!v) {
    log.error(`Missing required environment variable: ${key}`);
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
}

/** True when we should avoid all live network/side-effects and use fixtures. */
export function isDryRun(argv: string[] = process.argv): boolean {
  return argv.includes("--dry-run") || env("DRY_RUN") === "1";
}
