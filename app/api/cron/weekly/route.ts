import { NextResponse } from "next/server";
import { runWeeklyRefresh } from "@/lib/weekly-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refresh job (GitHub Actions → here, every 2 days at 00:00 UTC):
 *   1) RT sweep — resolve missing Tomatometer/Popcornmeter/Metacritic scores
 *   2) Surprise pool rebuild — 2-day-seeded pool
 *
 * Requires CRON_SECRET:
 *   Authorization: Bearer <secret>   or   ?secret=<secret>
 * Optional: ?rtBatch=200 to tune the sweep size (default 150, max 400).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set on the server" },
      { status: 500 }
    );
  }
  const auth = request.headers.get("authorization");
  const url = new URL(request.url);
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (bearer !== secret && url.searchParams.get("secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rtBatchParam = Number(url.searchParams.get("rtBatch"));
  const rtBatch = Number.isFinite(rtBatchParam) && rtBatchParam > 0 ? rtBatchParam : undefined;

  try {
    const result = await runWeeklyRefresh({ rtBatch });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Weekly cron failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
