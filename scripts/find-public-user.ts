/**
 * Find the active user(s) in the live tvtime DB and their watch history counts.
 * Read-only. Uses pg.Client directly (pool contention gotcha — see tvtime-app skill).
 * Run: npx tsx scripts/find-public-user.ts
 */
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("NO DATABASE_URL in env (.env = LIVE, .env.local = dead)");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const users = await client.query(
    `SELECT u.id, u.username,
            (SELECT COUNT(*) FROM watch_history wh WHERE wh.user_id = u.id) AS watch_count,
            (SELECT COUNT(*) FROM user_movies um WHERE um.user_id = u.id) AS movie_count
     FROM users u
     ORDER BY watch_count DESC`
  );

  console.log("USERS:");
  for (const row of users.rows) {
    console.log(
      JSON.stringify({
        id: row.id,
        email: row.email,
        username: row.username,
        public_handle: row.public_handle ?? null,
        public_profile: row.public_profile ?? false,
        watch_count: Number(row.watch_count),
        movie_count: Number(row.movie_count),
      })
    );
  }

  // Sample of latest watch history (deduped by tmdb for first 15)
  const sample = await client.query(
    `SELECT wh.*, m.title AS movie_title, s.title AS show_title
     FROM watch_history wh
     LEFT JOIN movies m ON m.tmdb_id = wh.tmdb_id AND wh.media_type = 'movie'
     LEFT JOIN shows s ON s.tmdb_id = wh.tmdb_id AND wh.media_type = 'tv'
     ORDER BY wh.watched_at DESC
     LIMIT 15`
  );
  console.log("\nLATEST WATCH EVENTS (all users):");
  for (const r of sample.rows) {
    console.log(
      `${r.watched_at.toISOString?.() ?? r.watched_at} | ${r.media_type} | tmdb=${r.tmdb_id} | S${r.season_number}E${r.episode_number} | ${r.source} | ${r.movie_title ?? r.show_title ?? "(no meta)"}`
    );
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
