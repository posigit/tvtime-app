import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, parseMediaParams, SHARED_UA } from "@/lib/stream-proxy";

/**
 * ythd.org signed-embed minter.
 *
 * ythd's vs_src.php mints time-signed cloudorchestranova.com embed URLs from
 * plain TMDB ids (no auth). The iframe points at THIS route and follows the
 * 302 to the fresh signed embed — so tokens are always minted at play time
 * and no token ever persists. Server-side fetch avoids any CORS friction.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let params: ReturnType<typeof parseMediaParams>;
  try {
    params = parseMediaParams(req.nextUrl.searchParams);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 }
    );
  }

  try {
    const q = new URLSearchParams({ type: params.type, id: String(params.id) });
    if (params.type === "tv") {
      q.set("season", String(params.season));
      q.set("episode", String(params.episode));
    }
    const res = await fetchWithTimeout(
      `https://ythd.org/vs_src.php?${q.toString()}`,
      {
        headers: {
          "User-Agent": SHARED_UA,
          Referer: "https://ythd.org/",
          Accept: "application/json",
        },
        cache: "no-store",
      },
      12_000
    );
    if (!res.ok) throw new Error(`ythd minter ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) throw new Error("ythd minter returned non-JSON");
    const data = (await res.json()) as { src?: string };
    if (!data.src || !data.src.startsWith("https://cloudorchestranova.com/embed/")) {
      throw new Error("ythd minter returned no signed embed");
    }
    // 302 through the iframe: the frame lands on the signed embed directly.
    return NextResponse.redirect(data.src, 302);
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
