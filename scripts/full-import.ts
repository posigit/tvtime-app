import { db } from "../lib/db";
import { parseGdprExport } from "../lib/import/parser";
import { importLists, importMovies, importShows } from "../lib/import/importer";
import { mapMoviesToTmdb, mapShowsToTmdb } from "../lib/import/tmdb-mapper";
import path from "path";

async function main() {
  const user = await db.query.users.findFirst();
  if (!user) {
    console.error("No user found");
    process.exit(1);
  }

  console.log(`Starting full import for user: ${user.username}`);

  const data = await parseGdprExport(path.join(process.cwd(), "..", "gdpr-data"));

  console.log(`Parsed: ${data.shows.size} shows, ${data.movies.length} movies, ${data.episodeWatches.length} watches, ${data.episodeReactions.length} episode reactions, ${data.movieReactions.length} movie reactions, ${data.lists.length} lists`);

  const showMappings = await mapShowsToTmdb(
    Array.from(data.shows.values()).map((s) => ({ tvShowId: s.tvShowId, name: s.name }))
  );
  const mappedShows = showMappings.filter((m) => m.selectedTmdbId).length;
  const reviewShows = showMappings.filter((m) => m.needsReview).length;
  console.log(`Shows mapped: ${mappedShows}/${showMappings.length}, need review: ${reviewShows}`);

  const movieMappings = await mapMoviesToTmdb(
    data.movies.map((m) => ({ name: m.name, releaseDate: m.releaseDate }))
  );
  const mappedMovies = movieMappings.filter((m) => m.selectedTmdbId).length;
  const reviewMovies = movieMappings.filter((m) => m.needsReview).length;
  console.log(`Movies mapped: ${mappedMovies}/${movieMappings.length}, need review: ${reviewMovies}`);

  console.log("Importing shows...");
  await importShows(user.id, showMappings, data);

  console.log("Importing movies...");
  await importMovies(user.id, movieMappings, data);

  console.log("Importing lists...");
  await importLists(user.id, showMappings, movieMappings, data);

  console.log("Full import complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
