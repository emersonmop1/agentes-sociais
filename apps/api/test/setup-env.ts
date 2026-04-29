/**
 * Vitest setupFile — loads the repo-root .env into process.env before any
 * test imports the API code. Mirrors the way `node --env-file=...` works
 * for `pnpm dev`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(__dirname, "../../../.env");
try {
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!key || process.env[key] !== undefined) continue;
    // Strip surrounding quotes if present
    const v = value!.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    process.env[key] = v;
  }
} catch {
  // Tests will fail loudly if env is missing — let them.
}
