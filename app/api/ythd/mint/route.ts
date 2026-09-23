import { NextRequest, NextResponse } from "next/server";

/**
 * ythd.org signed-embed minter.
 *
 * ythd's vs_src.php mints time-signed cloudorchestranova.com embed URLs from
 * plain TMDB ids (no auth). The iframe points at THIS route and follows the
 * 302 to the fresh signed embed — so tokens are always minted at play time
 * and no token ever persists. Server-side fetch avoids any CORS friction.
 */
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  const idRaw = sp.get("id");
  const season = sp.get("season");
  const episode = sp.get("episode");

  if ((type !== "movie" && type !== "tv") || !idRaw) {
    return NextResponse.json(
      { error: "type (movie|tv) and id are required" },
      { status: 400 }
    );
  }
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const q = new URLSearchParams({ type, id: String(id) });
    if (type === "tv" && season != null && episode != null) {
      q.set("season", season);
      q.set("episode", episode);
    }
    const res = await fetch(`https://ythd.org/vs_src.php?${q.toString()}`, {
      headers: {
        "User-Agent": UA,
        Referer: "https://ythd.org/",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ythd minter ${res.status}`);
    const data = (await res.json()) as { src?: string };
    if (!data.src || !data.src.startsWith("https://cloudorchestranova.com/embed/")) {
      throw new Error("ythd minter returned no signed embed");
    }
    // 302 through the iframe: the frame lands on the signed embed directly.
    return NextResponse.redirect(data.src);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ythd mint failed";
    return NextResponse.json(
      {
        error: message,
        code: "upstream_unreachable",
        detail: "ythd.org minter unreachable from this deployment.",
      },
      { status: 502 }
    );
  }
}
