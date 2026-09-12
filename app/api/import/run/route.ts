import { auth } from "@/lib/auth";
import { parseGdprExport } from "@/lib/import/parser";
import { clearStaging, stagingDir } from "@/lib/import/staging";
import { importLists, importMovies, importShows } from "@/lib/import/importer";
import { TmdbMappingResult } from "@/lib/import/tmdb-mapper";
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const EXPORT_DIR = path.join(process.cwd(), "..", "gdpr-data");

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { showMappings, movieMappings, uploaded } = (await request.json()) as {
      showMappings: TmdbMappingResult[];
      movieMappings: TmdbMappingResult[];
      uploaded?: boolean;
    };

    // Uploaded zips were staged at parse time (serverless-safe per-instance
    // tmp); fall back to the legacy folder when absent.
    let dir = EXPORT_DIR;
    if (uploaded) {
      const staged = stagingDir(session.user.id);
      try {
        await fs.access(staged);
        dir = staged;
      } catch {
        return NextResponse.json(
          { error: "Upload expired — parse the zip again" },
          { status: 400 }
        );
      }
    }

    const data = await parseGdprExport(dir);

    await importShows(session.user.id, showMappings, data);
    await importMovies(session.user.id, movieMappings, data);
    await importLists(session.user.id, showMappings, movieMappings, data);

    if (uploaded) await clearStaging(session.user.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Import run error:", err);
    return NextResponse.json(
      { error: "Failed to run import", details: (err as Error).message },
      { status: 500 }
    );
  }
}
