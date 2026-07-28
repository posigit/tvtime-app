/**
 * Backfill Rotten Tomatoes scores for all TV shows via:
 *   1) OMDb (when imdb_id exists)
 *   2) RT /tv/{slug} page ld+json fallback
 *
 * Re-checks rows with rt_score IS NULL or rt_score = -1 (old OMDb-only "none").
 *
 * Usage: npx tsx scripts/backfill-rt-tv.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { Pool } from "pg";
import { getRottenTomatoesScore } from "../lib/omdb";
import { getTvTomatometerFromRt } from "../lib/rt-tv";
import { getTvExternalIds } from "../lib/tmdb";

const RT_NONE = -1;
const DELAY_MS = 350;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  tmdb_id: number;
  title: string;
  imdb_id: string | null;
  first_air_date: string | null;
  rt_score: number | null;
};

async function resolveShow(row: Row): Promise<"score" | "none" | "fail"> {
  let imdbId = row.imdb_id;
  if (!imdbId) {
    try {
      const ids = await getTvExternalIds(row.tmdb_id);
      imdbId = ids.imdb_id ?? null;
    } catch {
      // continue without imdb
    }
  }

  let score: number | null = null;
  let checked = false;

  if (imdbId) {
    const omdb = await getRottenTomatoesScore(imdbId);
    score = omdb.score;
    checked = omdb.checked;
  }

  if (score == null) {
    const rt = await getTvTomatometerFromRt(row.title, row.first_air_date);
    if (rt.score != null) {
      score = rt.score;
      checked = true;
    } else if (rt.checked) {
      checked = true;
    }
  }

  if (!checked && !imdbId) {
    // Nothing to go on — mark none so we don't loop forever
    await pool.query(
      `UPDATE shows SET rt_score = $1 WHERE tmdb_id = $2`,
      [RT_NONE, row.tmdb_id]
    );
    return "none";
  }

  if (!checked) {
    if (imdbId && imdbId !== row.imdb_id) {
      await pool.query(`UPDATE shows SET imdb_id = $1 WHERE tmdb_id = $2`, [
        imdbId,
        row.tmdb_id,
      ]);
    }
    return "fail";
  }

  await pool.query(
    `UPDATE shows SET imdb_id = COALESCE($1, imdb_id), rt_score = $2 WHERE tmdb_id = $3`,
    [imdbId, score ?? RT_NONE, row.tmdb_id]
  );
  return score != null ? "score" : "none";
}

async function main() {
  const { rows: allRows } = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM shows`
  );
  const { rows: todo } = await pool.query<Row>(
    `SELECT tmdb_id, title, imdb_id, first_air_date, rt_score
     FROM shows
     WHERE rt_score IS NULL OR rt_score < 0
     ORDER BY title`
  );

  console.log(
    `Shows to resolve: ${todo.length} (of ${allRows[0].total} total)`
  );

  let score = 0;
  let none = 0;
  let fail = 0;

  for (let i = 0; i < todo.length; i++) {
    const row = todo[i];
    try {
      const result = await resolveShow(row);
      if (result === "score") {
        score++;
        const { rows: u } = await pool.query(
          `SELECT rt_score FROM shows WHERE tmdb_id = $1`,
          [row.tmdb_id]
        );
        console.log(
          `  [${i + 1}/${todo.length}] 🍅 ${row.title} → ${u[0].rt_score}%`
        );
      } else if (result === "none") {
        none++;
        console.log(`  [${i + 1}/${todo.length}] — ${row.title} (no RT)`);
      } else {
        fail++;
        console.log(`  [${i + 1}/${todo.length}] ! ${row.title} (retry later)`);
      }
    } catch (err) {
      fail++;
      console.log(
        `  [${i + 1}/${todo.length}] ! ${row.title}:`,
        err instanceof Error ? err.message : err
      );
    }
    await sleep(DELAY_MS);
  }

  const summary = await pool.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE rt_score >= 0)::int AS with_rt,
           count(*) FILTER (WHERE rt_score = -1)::int AS no_rt,
           count(*) FILTER (WHERE rt_score IS NULL)::int AS pending
    FROM shows
  `);
  console.log(`\nDone: ${score} with RT, ${none} no RT, ${fail} failed`);
  console.log("Shows summary:", summary.rows[0]);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
