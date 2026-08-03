/**
 * Run the weekly job directly against the DB (no HTTP / deploy needed):
 *   1) RT sweep — resolve missing Tomatometer/Popcornmeter/Metacritic scores
 *   2) Surprise pool rebuild
 *
 * Usage:
 *   npx tsx scripts/weekly-refresh.ts            # default batch 150
 *   npx tsx scripts/weekly-refresh.ts 300        # custom RT batch size
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  // Dynamic imports: lib/db creates its Pool at module load, so it must be
  // imported only after dotenv has populated process.env.
  const { runWeeklyRefresh } = await import("../lib/weekly-job");
  const { pool } = await import("../lib/db");

  if (!process.env.OMDB_API_KEY) {
    console.error("OMDB_API_KEY is not set");
    process.exit(1);
  }
  if (!process.env.TMDB_API_KEY) {
    console.error("TMDB_API_KEY is not set");
    process.exit(1);
  }

  const arg = Number(process.argv[2]);
  const rtBatch = Number.isFinite(arg) && arg > 0 ? arg : undefined;

  const result = await runWeeklyRefresh({ rtBatch });
  console.log(JSON.stringify(result, null, 2));

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
