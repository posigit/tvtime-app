import { NextResponse } from "next/server";
import { pingDb } from "@/lib/db";

/**
 * Lightweight health + DB keep-alive endpoint.
 *
 * Point an external cron (cron-job.org, UptimeRobot, GitHub Actions)
 * at GET /api/health every 5–10 minutes to reduce Railway cold starts.
 *
 * Optional: set HEALTH_CRON_SECRET and call with
 *   Authorization: Bearer <secret>
 * or ?secret=<secret>
 */
export async function GET(request: Request) {
  const secret = process.env.HEALTH_CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const url = new URL(request.url);
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const querySecret = url.searchParams.get("secret");
    if (bearer !== secret && querySecret !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const started = Date.now();
  // Integration presence (flags only, never values) so a dashboard can tell
  // "not configured" apart from "down" — e.g. OpenSubtitles 501s.
  const integrations = {
    tmdb: Boolean(
      process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY
    ),
    vixResolver: Boolean(process.env.VIX_RESOLVER_URL),
    openSubtitles:
      Boolean(process.env.OPENSUBTITLES_API_KEY) &&
      Boolean(process.env.OPENSUBTITLES_USERNAME) &&
      Boolean(process.env.OPENSUBTITLES_PASSWORD),
    push:
      Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) &&
      Boolean(process.env.VAPID_PRIVATE_KEY),
  };
  try {
    // A few retries so a mid-wake ping still succeeds
    await pingDb(5, 1000);
    return NextResponse.json({
      ok: true,
      db: "up",
      ms: Date.now() - started,
      ts: new Date().toISOString(),
      integrations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        db: "down",
        error: message,
        ms: Date.now() - started,
        ts: new Date().toISOString(),
        integrations,
      },
      { status: 503 }
    );
  }
}
