/**
 * One-time + rerunnable correction: fix Apple TV+ episode air dates.
 *
 * TMDB records Apple TV+ air dates one day early (Pacific date).
 * TVMaze carries the official Eastern/network date (matches Apple, Google, RT).
 *
 * Usage:
 *   npx tsx scripts/fix-apple-airdates.ts [--dry-run]
 *
 * Loads .env (tokaido = live prod DB). Prints every changed row.
 */
import { config } from "dotenv";
// .env (tokaido) is the LIVE prod DB — force it over .env.local (autorack, dead).
config({ path: ".env.local" });
config({ path: ".env", override: true });

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const { db, pool } = await import("../lib/db");
  const { shows, episodes } = await import("../lib/schema");
  const { eq, and } = await import("drizzle-orm");
  const {
    getTvmazeAirdateMap,
    isAppleTv,
  } = await import("../lib/tvmaze");

  const appleShows = await db
    .select({
      tmdbId: shows.tmdbId,
      title: shows.title,
      networks: shows.networks,
      firstAirDate: shows.firstAirDate,
    })
    .from(shows);

  const targets = appleShows.filter((s) => isAppleTv(s.networks));
  console.log(
    `Apple TV+ shows: ${targets.length}/${appleShows.length} (dry-run: ${DRY_RUN})`
  );

  let fixed = 0;
  let skipped = 0;
  let notFound = 0;

  for (const show of targets) {
    const map = await getTvmazeAirdateMap(show.title, show.firstAirDate);
    if (!map) {
      notFound++;
      console.log(`  [missing] ${show.title} — no TVMaze match`);
      continue;
    }

    const eps = await db
      .select({
        seasonNumber: episodes.seasonNumber,
        episodeNumber: episodes.episodeNumber,
        airDate: episodes.airDate,
      })
      .from(episodes)
      .where(eq(episodes.showTmdbId, show.tmdbId));

    let showFixes = 0;
    for (const ep of eps) {
      const key = `${ep.seasonNumber}:${ep.episodeNumber}`;
      const tvDate = map.get(key);
      if (!tvDate) continue;
      if (ep.airDate === tvDate) continue;

      console.log(
        `  ${show.title} S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")}: ${ep.airDate ?? "null"} -> ${tvDate}`
      );
      showFixes++;
      if (!DRY_RUN) {
        await db
          .update(episodes)
          .set({ airDate: tvDate, updatedAt: new Date() })
          .where(
            and(
              eq(episodes.showTmdbId, show.tmdbId),
              eq(episodes.seasonNumber, ep.seasonNumber),
              eq(episodes.episodeNumber, ep.episodeNumber)
            )
          );
      }
    }

    if (showFixes === 0) skipped++;
    else fixed += showFixes;
  }

  console.log(
    `\nDone. Episodes corrected: ${fixed} (${skipped} shows already correct, ${notFound} no TVMaze match)`
  );
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
