/**
 * One-shot: resolve rt_score for every show/movie that still has null.
 * - Real Tomatometer (0–100) when OMDb has Rotten Tomatoes
 * - -1 when OMDb answered with no RT entry (stops future retries)
 * - Leaves null only on failure / rate limit (retry later)
 *
 * Usage: npx tsx scripts/backfill-rt.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { Pool } from "pg";
import { getRottenTomatoesScore } from "../lib/omdb";
import { getTvExternalIds, getMovieExternalIds } from "../lib/tmdb";

const RT_NONE = -1;
const DELAY_MS = 120; // stay polite to OMDb free tier

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = { tmdb_id: number; title: string; imdb_id: string | null };

async function resolveOne(
  row: Row,
  type: "tv" | "movie"
): Promise<"score" | "none" | "fail" | "skip"> {
  let imdbId = row.imdb_id;
  if (!imdbId) {
    try {
      const ids =
        type === "tv"
          ? await getTvExternalIds(row.tmdb_id)
          : await getMovieExternalIds(row.tmdb_id);
      imdbId = ids.imdb_id ?? null;
    } catch (err) {
      console.warn(
        `  TMDB external_ids failed ${type} ${row.tmdb_id}:`,
        err instanceof Error ? err.message : err
      );
      return "fail";
    }
  }

  if (!imdbId) {
    await pool.query(
      `UPDATE ${type === "tv" ? "shows" : "movies"}
       SET imdb_id = NULL, rt_score = $1, rt_checked_at = NOW() WHERE tmdb_id = $2`,
      [RT_NONE, row.tmdb_id]
    );
    return "none";
  }

  const { score, checked } = await getRottenTomatoesScore(imdbId);
  if (!checked) {
    await pool.query(
      `UPDATE ${type === "tv" ? "shows" : "movies"}
       SET imdb_id = $1 WHERE tmdb_id = $2`,
      [imdbId, row.tmdb_id]
    );
    return "fail";
  }

  const rtScore = score ?? RT_NONE;
  await pool.query(
    `UPDATE ${type === "tv" ? "shows" : "movies"}
     SET imdb_id = $1, rt_score = $2, rt_checked_at = NOW() WHERE tmdb_id = $3`,
    [imdbId, rtScore, row.tmdb_id]
  );
  return score != null ? "score" : "none";
}

async function backfillTable(type: "tv" | "movie") {
  const table = type === "tv" ? "shows" : "movies";
  const { rows } = await pool.query<Row>(
    `SELECT tmdb_id, title, imdb_id FROM ${table}
     WHERE rt_score IS NULL
     ORDER BY imdb_id NULLS LAST, tmdb_id`
  );

  console.log(`\n=== ${table}: ${rows.length} unresolved ===`);
  let score = 0;
  let none = 0;
  let fail = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = await resolveOne(row, type);
    if (result === "score") {
      score++;
      const { rows: updated } = await pool.query(
        `SELECT rt_score FROM ${table} WHERE tmdb_id = $1`,
        [row.tmdb_id]
      );
      console.log(
        `  [${i + 1}/${rows.length}] 🍅 ${row.title} → ${updated[0].rt_score}%`
      );
    } else if (result === "none") {
      none++;
      console.log(
        `  [${i + 1}/${rows.length}] — ${row.title} (no RT / no imdb)`
      );
    } else {
      fail++;
      console.log(
        `  [${i + 1}/${rows.length}] ! ${row.title} (will retry later)`
      );
    }
    await sleep(DELAY_MS);
  }

  console.log(
    `${table} done: ${score} with RT, ${none} no RT, ${fail} failed`
  );
}

async function main() {
  if (!process.env.OMDB_API_KEY) {
    console.error("OMDB_API_KEY is not set");
    process.exit(1);
  }
  if (!process.env.TMDB_API_KEY) {
    console.error("TMDB_API_KEY is not set");
    process.exit(1);
  }

  // Prefer titles that already have imdb_id (cheap OMDb-only pass first would be
  // ideal, but one loop is fine — resolveOne reuses imdb when present).
  await backfillTable("tv");
  await backfillTable("movie");

  const summary = await pool.query(`
    SELECT 'shows' AS kind,
           count(*)::int AS total,
           count(*) FILTER (WHERE rt_score >= 0)::int AS with_rt,
           count(*) FILTER (WHERE rt_score = -1)::int AS no_rt,
           count(*) FILTER (WHERE rt_score IS NULL)::int AS pending
    FROM shows
    UNION ALL
    SELECT 'movies',
           count(*)::int,
           count(*) FILTER (WHERE rt_score >= 0)::int,
           count(*) FILTER (WHERE rt_score = -1)::int,
           count(*) FILTER (WHERE rt_score IS NULL)::int
    FROM movies
  `);
  console.log("\nFinal:", summary.rows);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
