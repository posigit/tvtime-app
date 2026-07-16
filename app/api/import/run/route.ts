import { auth } from "@/lib/auth";
import { parseGdprExport } from "@/lib/import/parser";
import { importLists, importMovies, importShows } from "@/lib/import/importer";
import { TmdbMappingResult } from "@/lib/import/tmdb-mapper";
import { NextResponse } from "next/server";
import path from "path";

const EXPORT_DIR = path.join(process.cwd(), "..", "gdpr-data");

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { showMappings, movieMappings } = (await request.json()) as {
      showMappings: TmdbMappingResult[];
      movieMappings: TmdbMappingResult[];
    };

    const data = await parseGdprExport(EXPORT_DIR);

    await importShows(session.user.id, showMappings, data);
    await importMovies(session.user.id, movieMappings, data);
    await importLists(session.user.id, showMappings, movieMappings, data);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Import run error:", err);
    return NextResponse.json(
      { error: "Failed to run import", details: (err as Error).message },
      { status: 500 }
    );
  }
}
