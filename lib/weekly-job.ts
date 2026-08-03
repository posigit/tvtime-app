/**
 * Thursday-night weekly job, triggered by GitHub Actions → /api/cron/weekly
 * (or locally via scripts/weekly-refresh.ts):
 *
 *   1) RT sweep — resolve Tomatometer/Popcornmeter/Metacritic for rows that
 *      still have none (rt_score NULL or -1), plus re-check recent releases
 *      whose meters still move. Heals titles the lazy per-page fill missed.
 *   2) Surprise pool rebuild — fresh week-seeded TMDB slices into
 *      surprise_pool so the pick list never runs dry.
 */

import { db, withDbRetry, pingDb } from "./db";
import { shows, movies } from "./schema";
import { resolveRtScores } from "./rt-resolve";
import { rebuildSurprisePool } from "./surprise-movies";
import { appTodayYmd, ymdAddDays } from "./app-time";
import { asc, isNull, or, lt, and, gte, sql, type SQL } from "drizzle-orm";

const RT_NONE = -1;
const SLEEP_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SweepTableResult = {
  table: "shows" | "movies";
  scanned: number;
  scored: number;
  none: number;
  failed: number;
};

export type WeeklyJobResult = {
  ok: boolean;
  startedAt: string;
  durationMs: number;
  rtSweep: SweepTableResult[];
  surprise: { week: string; count: number } | null;
  error?: string;
};

/** Rows needing (re)resolution: never resolved, previously "no RT", or
 *  resolved before Popcornmeter/Metacritic tracking existed. */
function unresolvedCond(table: typeof shows | typeof movies): SQL {
  return or(
    isNull(table.rtScore),
    lt(table.rtScore, 0),
    isNull(table.rtAudienceScore)
  )!;
}

async function sweepTable(
  type: "tv" | "movie",
  batch: number
): Promise<SweepTableResult> {
  const table = type === "tv" ? shows : movies;
  const result: SweepTableResult = {
    table: type === "tv" ? "shows" : "movies",
    scanned: 0,
    scored: 0,
    none: 0,
    failed: 0,
  };
  if (batch <= 0) return result;

  // Recent releases: meters appear/move for weeks after release — re-check
  // them weekly even when a score exists.
  const recentCutoff = ymdAddDays(appTodayYmd(), -90);
  const staleCheck = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateCol = type === "tv" ? shows.firstAirDate : movies.releaseDate;
  const recentCond = and(
    gte(dateCol, recentCutoff),
    or(isNull(table.rtCheckedAt), lt(table.rtCheckedAt, staleCheck))
  );

  const rows = await withDbRetry(() =>
    db
      .select({
        tmdbId: table.tmdbId,
        title: table.title,
        imdbId: table.imdbId,
        rtScore: table.rtScore,
        date: dateCol,
      })
      .from(table)
      .where(or(unresolvedCond(table), recentCond)!)
      // Never-checked rows first, then oldest check first
      .orderBy(
        sql`${table.rtCheckedAt} ASC NULLS FIRST`,
        asc(table.tmdbId)
      )
      .limit(batch)
  );

  for (const row of rows) {
    result.scanned++;
    try {
      const r = await resolveRtScores({
        type,
        tmdbId: row.tmdbId,
        imdbId: row.imdbId,
        title: row.title,
        date: row.date,
      });

      if (!r.checked) {
        result.failed++;
        if (r.imdbId && r.imdbId !== row.imdbId) {
          await db
            .update(table)
            .set({ imdbId: r.imdbId })
            .where(sql`tmdb_id = ${row.tmdbId}`);
        }
      } else {
        const now = new Date();
        await db
          .update(table)
          .set({
            ...(r.imdbId ? { imdbId: r.imdbId } : {}),
            rtScore: r.score ?? RT_NONE,
            rtAudienceScore: r.audienceScore ?? RT_NONE,
            mcScore: r.mcScore ?? RT_NONE,
            rtCheckedAt: now,
          })
          .where(sql`tmdb_id = ${row.tmdbId}`);
        if (r.score != null) result.scored++;
        else result.none++;
      }
    } catch (err) {
      result.failed++;
      console.error(
        `weekly sweep ${type} ${row.tmdbId} (${row.title}):`,
        err instanceof Error ? err.message : err
      );
    }
    await sleep(SLEEP_MS);
  }

  return result;
}

export async function runWeeklyRefresh(opts?: {
  rtBatch?: number;
  skipSurprise?: boolean;
}): Promise<WeeklyJobResult> {
  const started = Date.now();
  const batch = Math.max(1, Math.min(opts?.rtBatch ?? 150, 400));
  const perTable = Math.ceil(batch / 2);

  // Railway Postgres may be waking from sleep — retry through the cold start
  await pingDb(8, 1500);

  const rtSweep: SweepTableResult[] = [];
  rtSweep.push(await sweepTable("tv", perTable));
  rtSweep.push(await sweepTable("movie", perTable));

  let surprise: { week: string; count: number } | null = null;
  if (!opts?.skipSurprise) {
    try {
      surprise = await rebuildSurprisePool();
    } catch (err) {
      console.error(
        "Surprise pool rebuild failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    ok: true,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    rtSweep,
    surprise,
  };
}
