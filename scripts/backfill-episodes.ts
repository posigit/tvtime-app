import "dotenv/config";
import { db } from "../lib/db";
import { shows, episodes } from "../lib/schema";
import { getTvSeason } from "../lib/tmdb";
import { sql } from "drizzle-orm";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function backfillShow(
  tmdbId: number,
  numberOfSeasons: number | null
): Promise<number> {
  if (!numberOfSeasons || numberOfSeasons <= 0) return 0;

  let inserted = 0;

  for (let seasonNumber = 1; seasonNumber <= numberOfSeasons; seasonNumber++) {
    try {
      const seasonData = await getTvSeason(tmdbId, seasonNumber);

      if (seasonData.episodes.length === 0) continue;

      const rows = seasonData.episodes.map((ep) => ({
        showTmdbId: tmdbId,
        seasonNumber: ep.season_number,
        episodeNumber: ep.episode_number,
        title: ep.name || `Episode ${ep.episode_number}`,
        overview: ep.overview ?? null,
        airDate: ep.air_date ?? null,
        stillPath: ep.still_path ?? null,
        runtime: ep.runtime ?? null,
      }));

      for (const row of rows) {
        await db
          .insert(episodes)
          .values(row)
          .onConflictDoUpdate({
            target: [
              episodes.showTmdbId,
              episodes.seasonNumber,
              episodes.episodeNumber,
            ],
            set: {
              title: sql`EXCLUDED.title`,
              overview: sql`EXCLUDED.overview`,
              airDate: sql`EXCLUDED.air_date`,
              stillPath: sql`EXCLUDED.still_path`,
              runtime: sql`EXCLUDED.runtime`,
              updatedAt: new Date(),
            },
          });
        inserted++;
      }

      await sleep(50);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("404")) {
        console.error(`  Season ${seasonNumber} failed:`, message);
      }
    }
  }

  return inserted;
}

async function main() {
  console.log("Fetching all shows from database...");
  const allShows = await db
    .select({
      tmdbId: shows.tmdbId,
      title: shows.title,
      numberOfSeasons: shows.numberOfSeasons,
    })
    .from(shows);

  console.log(`Found ${allShows.length} shows to backfill`);

  let totalInserted = 0;
  let processed = 0;
  const failed: Array<{ tmdbId: number; title: string }> = [];

  const concurrencyLimit = 4;
  const queue = [...allShows];
  const running: Promise<void>[] = [];

  while (queue.length > 0 || running.length > 0) {
    while (running.length < concurrencyLimit && queue.length > 0) {
      const show = queue.shift()!;
      const promise = (async () => {
        const count = await backfillShow(
          show.tmdbId,
          show.numberOfSeasons
        ).catch((err) => {
          console.error(`Show ${show.title} (${show.tmdbId}) failed:`, err);
          failed.push({ tmdbId: show.tmdbId, title: show.title });
          return 0;
        });
        totalInserted += count;
        processed++;
        const pct = Math.round((processed / allShows.length) * 100);
        console.log(
          `[${pct}%] (${processed}/${allShows.length}) ${show.title} — ${count} episodes`
        );
      })().finally(() => {
        const idx = running.indexOf(promise);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(promise);
    }
    if (running.length > 0) {
      await Promise.race(running);
      await sleep(100);
    }
  }

  console.log(`\nBackfill complete!`);
  console.log(`  Total episodes inserted/updated: ${totalInserted}`);
  console.log(`  Shows processed: ${processed}/${allShows.length}`);
  if (failed.length > 0) {
    console.log(`  Failed shows (${failed.length}):`);
    for (const f of failed) {
      console.log(`    - ${f.title} (${f.tmdbId})`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
