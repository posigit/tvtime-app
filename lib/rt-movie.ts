/**
 * Rotten Tomatoes movie Tomatometer + Popcornmeter via public /m/{slug} pages.
 * Movie fallback when OMDb has no RT entry (common for recent releases).
 */

import { fetchRtPageHtml, parseRtPageScores } from "./rt-page";
import { titleToRtSlug, titlesMatch } from "./rt-tv";

export type RtMovieLookupResult = {
  score: number | null;
  audienceScore: number | null;
  checked: boolean;
  slug?: string;
};

function candidateSlugs(title: string, year?: string | null): string[] {
  const base = titleToRtSlug(title);
  if (!base) return [];

  const bases: string[] = [base];
  if (base.startsWith("the_")) bases.push(base.slice(4));

  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!s || seen.has(s)) return;
    seen.add(s);
    ordered.push(s);
  };

  // Year-disambiguated first (dune_2021, the_invite_2026, …)
  if (year && /^\d{4}$/.test(year)) {
    for (const s of bases) push(`${s}_${year}`);
  }
  for (const s of bases) push(s);

  return ordered;
}

/**
 * Look up movie Tomatometer + Popcornmeter by title (and optional release year).
 * Verifies the page is a Movie whose name matches before trusting its score.
 */
export async function getMovieTomatometerFromRt(
  title: string,
  releaseDate?: string | null
): Promise<RtMovieLookupResult> {
  if (!title?.trim()) {
    return { score: null, audienceScore: null, checked: false };
  }

  const year = releaseDate?.slice(0, 4) ?? null;
  const slugs = candidateSlugs(title, year);
  let anyPage = false;
  let matchedNoScore = false;

  for (const slug of slugs) {
    const html = await fetchRtPageHtml("m", slug);
    if (!html) continue;
    anyPage = true;

    const { tomatometer, audienceScore, name, type } = parseRtPageScores(html);
    const typeOk = !type || type === "Movie";
    if (!typeOk) continue;

    const nameOk = !name || titlesMatch(title, name);
    if (!nameOk) continue;

    if (tomatometer != null || audienceScore != null) {
      return { score: tomatometer, audienceScore, checked: true, slug };
    }
    matchedNoScore = true;
  }

  if (matchedNoScore || anyPage) {
    return { score: null, audienceScore: null, checked: true };
  }
  return { score: null, audienceScore: null, checked: false };
}
