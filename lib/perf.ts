/**
 * Dev-first server timing for DB sections.
 *
 * Logs `[perf] <label>: Nms` so a single page load ranks the slowest
 * queries. Enabled in non-production by default; in production only when
 * `PERF_LOG=1` (keeps prod logs quiet otherwise).
 *
 * Usage: `await timed("profile:recent", () => db.select()...)`
 */
const ENABLED =
  process.env.NODE_ENV !== "production" || process.env.PERF_LOG === "1";

export async function timed<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!ENABLED) return fn();
  const start = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[perf] ${label}: ${Date.now() - start}ms`);
  }
}

/**
 * Capture a start timestamp for a page-total measurement.
 * (Separate helper so server components don't call the impure
 * `Date.now()` directly in render scope.)
 */
export function perfStart(): number {
  return Date.now();
}

/** Log elapsed ms since a `perfStart()` captured earlier (page totals). */
export function perfLog(label: string, start: number): void {
  if (!ENABLED) return;
  console.log(`[perf] ${label}: ${Date.now() - start}ms`);
}
