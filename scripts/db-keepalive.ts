/**
 * Ping Postgres so managed hosts (Railway, etc.) stay warm.
 *
 * Usage:
 *   npx tsx scripts/db-keepalive.ts
 *
 * Windows Task Scheduler / cron every 5–10 minutes:
 *   cd C:\Users\USER\Desktop\tvtime-data\tvtime-app && npx tsx scripts\db-keepalive.ts
 *
 * Prefer hitting /api/health on a deployed app if the PC is not always on.
 *
 * Loads .env.local over .env so local keepalive hits the active DATABASE_URL.
 */
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });
import { pingDb, pool } from "../lib/db";

async function main() {
  const started = Date.now();
  await pingDb(10, 2000);
  console.log(`DB awake (${Date.now() - started}ms)`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Keep-alive failed:", err instanceof Error ? err.message : err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
