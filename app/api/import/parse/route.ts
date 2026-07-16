import { auth } from "@/lib/auth";
import { parseGdprExport } from "@/lib/import/parser";
import { mapMoviesToTmdb, mapShowsToTmdb } from "@/lib/import/tmdb-mapper";
import { NextResponse } from "next/server";
import path from "path";

const EXPORT_DIR = path.join(process.cwd(), "..", "gdpr-data");

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await parseGdprExport(EXPORT_DIR);

    const showRecords = Array.from(data.shows.values()).map((s) => ({
      tvShowId: s.tvShowId,
      name: s.name,
      firstAirDate: undefined, // We don't have this from export; TMDB search will handle it
    }));

    const showMappings = await mapShowsToTmdb(showRecords);
    const movieMappings = await mapMoviesToTmdb(data.movies);

    return NextResponse.json({
      stats: {
        shows: data.shows.size,
        episodeWatches: data.episodeWatches.length,
        movies: data.movies.length,
        episodeReactions: data.episodeReactions.length,
        movieReactions: data.movieReactions.length,
        lists: data.lists.length,
      },
      showMappings,
      movieMappings,
    });
  } catch (err) {
    console.error("Import parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse import", details: (err as Error).message },
      { status: 500 }
    );
  }
}
