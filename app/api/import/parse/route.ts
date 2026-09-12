import { auth } from "@/lib/auth";
import { parseGdprExport } from "@/lib/import/parser";
import { stageFiles } from "@/lib/import/staging";
import { mapMoviesToTmdb, mapShowsToTmdb } from "@/lib/import/tmdb-mapper";
import { NextResponse } from "next/server";
import { unzipSync } from "fflate";
import path from "path";

const EXPORT_DIR = path.join(process.cwd(), "..", "gdpr-data");

/** Zip bomb guards for uploads. */
const MAX_ZIP_FILES = 120;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_CSV_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let dir = EXPORT_DIR;
  let uploaded = false;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: "Zip file required" }, { status: 400 });
      }
      if (file.size > MAX_ZIP_BYTES) {
        return NextResponse.json({ error: "Zip too large (50MB max)" }, { status: 400 });
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const entries = unzipSync(buf);
      const names = Object.keys(entries).filter(
        (n) => !n.endsWith("/") && !n.includes("__MACOSX")
      );
      if (names.length === 0 || names.length > MAX_ZIP_FILES) {
        return NextResponse.json({ error: "No usable files in zip" }, { status: 400 });
      }
      const decoder = new TextDecoder("utf-8");
      const files = new Map<string, string>();
      for (const name of names) {
        const bytes = entries[name]!;
        if (bytes.length > MAX_CSV_BYTES) continue;
        files.set(name, decoder.decode(bytes));
      }
      const staged = await stageFiles(session.user.id, files);
      dir = staged.dir;
      uploaded = true;
    } catch (err) {
      return NextResponse.json(
        { error: "Couldn't read that zip", details: (err as Error).message },
        { status: 400 }
      );
    }
  }

  try {
    const data = await parseGdprExport(dir);

    const showRecords = Array.from(data.shows.values()).map((s) => ({
      tvShowId: s.tvShowId,
      name: s.name,
      firstAirDate: undefined, // We don't have this from export; TMDB search will handle it
    }));

    const showMappings = await mapShowsToTmdb(showRecords);
    const movieMappings = await mapMoviesToTmdb(data.movies);

    return NextResponse.json({
      uploaded,
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
