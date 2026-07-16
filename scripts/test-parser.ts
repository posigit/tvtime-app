import { parseGdprExport } from "../lib/import/parser";
import path from "path";

async function main() {
  const data = await parseGdprExport(path.join(process.cwd(), "..", "gdpr-data"));
console.log("Shows:", data.shows.size);
console.log("Episode watches:", data.episodeWatches.length);
console.log("Movies:", data.movies.length);
console.log("Episode reactions:", data.episodeReactions.length);
console.log("Movie reactions:", data.movieReactions.length);
console.log("Lists:", data.lists.length);
console.log(
  "Sample shows:",
  Array.from(data.shows.values())
    .slice(0, 5)
    .map((s) => ({ name: s.name, episodesWatched: s.episodesWatched, status: s.status, lastSeason: s.lastSeason, lastEpisode: s.lastEpisode }))
);
console.log("Sample movies:", data.movies.slice(0, 5));
console.log("Sample episode reactions:", data.episodeReactions.slice(0, 3));
console.log("Sample movie reactions:", data.movieReactions.slice(0, 3));
console.log("Sample lists:", data.lists);
}

main().catch(console.error);
