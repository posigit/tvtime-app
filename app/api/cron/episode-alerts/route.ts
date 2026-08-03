import { NextResponse } from "next/server";
import { db, pingDb } from "@/lib/db";
import {
  episodes,
  shows,
  userShows,
  pushSubscriptions,
} from "@/lib/schema";
import { and, eq, inArray } from "drizzle-orm";
import { appTodayYmd } from "@/lib/app-time";
import { sendPush, isPushGone } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Daily (13:00 UTC) new-episode push alerts.
 * One digest notification per user: "N episodes air today".
 * Requires CRON_SECRET (Bearer or ?secret=).
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

  try {
    await pingDb(5, 1000);
    const today = appTodayYmd();

    // Episodes airing today for followed shows
    const rows = await db
      .select({
        userId: userShows.userId,
        showTitle: shows.title,
        showTmdbId: shows.tmdbId,
        seasonNumber: episodes.seasonNumber,
        episodeNumber: episodes.episodeNumber,
        episodeTitle: episodes.title,
      })
      .from(episodes)
      .innerJoin(shows, eq(episodes.showTmdbId, shows.tmdbId))
      .innerJoin(userShows, eq(userShows.tmdbId, shows.tmdbId))
      .where(
        and(
          eq(episodes.airDate, today),
          inArray(userShows.status, ["watching", "for_later"])
        )
      );

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, date: today, alerts: 0 });
    }

    // Group by user → one digest push each
    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const arr = byUser.get(row.userId);
      if (arr) arr.push(row);
      else byUser.set(row.userId, [row]);
    }

    const subs = await db.select().from(pushSubscriptions);
    const subsByUser = new Map<string, typeof subs>();
    for (const s of subs) {
      const arr = subsByUser.get(s.userId);
      if (arr) arr.push(s);
      else subsByUser.set(s.userId, [s]);
    }

    let sent = 0;
    const staleEndpoints: string[] = [];

    for (const [userId, eps] of byUser) {
      const userSubs = subsByUser.get(userId);
      if (!userSubs || userSubs.length === 0) continue;

      const fmt = (e: (typeof eps)[number]) =>
        `${e.showTitle} S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`;

      const payload =
        eps.length === 1
          ? {
              title: `${eps[0].showTitle} is back tonight`,
              body: `${fmt(eps[0])} · ${eps[0].episodeTitle || "New episode"} airs today`,
              url: `/show/${eps[0].showTmdbId}`,
              tag: `ep-${today}-${eps[0].showTmdbId}`,
            }
          : {
              title: `${eps.length} episodes air today`,
              body: eps.slice(0, 3).map(fmt).join(" · ") + (eps.length > 3 ? ` +${eps.length - 3} more` : ""),
              url: "/calendar",
              tag: `ep-${today}`,
            };

      for (const sub of userSubs) {
        try {
          const ok = await sendPush(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload
          );
          if (ok) sent++;
        } catch (err) {
          if (isPushGone(err)) staleEndpoints.push(sub.endpoint);
        }
      }
    }

    // Clean up dead subscriptions
    for (const endpoint of staleEndpoints) {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, endpoint))
        .catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      date: today,
      users: byUser.size,
      alerts: sent,
      pruned: staleEndpoints.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Episode alerts failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
