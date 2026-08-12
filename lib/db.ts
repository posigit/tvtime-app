import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Enough for page load + a few parallel ensure* without stampeding Railway
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
  // Don't fail the whole pool on one bad connection during cold start
  allowExitOnIdle: true,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err.message);
});

export const db = drizzle(pool, { schema });
export { pool };

function errCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  if ("code" in err && err.code != null) return String(err.code);
  // Drizzle wraps pg errors in cause
  if ("cause" in err && err.cause && typeof err.cause === "object" && "code" in err.cause) {
    return String((err.cause as { code: unknown }).code);
  }
  return "";
}

function errMessage(err: unknown): string {
  if (err instanceof Error) {
    const nested =
      "cause" in err && err.cause instanceof Error ? err.cause.message : "";
    return nested ? `${err.message} ${nested}` : err.message;
  }
  return String(err);
}

/** True for Railway cold starts, dropped connections, timeouts, etc. */
export function isTransientDbError(err: unknown): boolean {
  const code = errCode(err);
  const message = errMessage(err).toLowerCase();

  if (
    code === "57P03" || // starting up
    code === "57P01" || // admin shutdown
    code === "08006" || // connection failure
    code === "08001" || // sqlclient unable to establish
    code === "08003" || // connection does not exist
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND"
  ) {
    return true;
  }

  return (
    message.includes("starting up") ||
    message.includes("connection terminated") ||
    message.includes("connection refused") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("timeout") ||
    message.includes("too many clients") ||
    message.includes("server closed the connection") ||
    message.includes("cannot connect") ||
    message.includes("failed query") // Drizzle wrapper; often wraps transient cause
  );
}

/**
 * Run a DB operation with retries on transient connection / cold-start errors.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 8,
  baseDelayMs = 1500
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientDbError(err) || attempt === maxAttempts) {
        throw err;
      }
      const delay = Math.min(baseDelayMs * attempt, 8_000);
      console.warn(
        `DB transient error (attempt ${attempt}/${maxAttempts}): ${errMessage(err)}. Retrying in ${delay}ms…`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Ping the DB with retries. Use after cold starts when Postgres
 * returns 57P03 ("the database system is starting up").
 */
export async function pingDb(maxAttempts = 8, baseDelayMs = 1500): Promise<void> {
  await withDbRetry(async () => {
    await pool.query("SELECT 1");
  }, maxAttempts, baseDelayMs);
}

/**
 * Run async work over items with limited concurrency (avoids pool exhaustion
 * when ensuring 100+ shows in parallel).
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
