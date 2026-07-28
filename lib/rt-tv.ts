/**
 * Rotten Tomatoes series Tomatometer via public TV pages (ld+json).
 * Used as a TV fallback when OMDb has no RT score.
 */

const RT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type RtTvLookupResult = {
  score: number | null;
  checked: boolean;
  slug?: string;
};

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Normalize for loose title comparison (not for slugs). */
export function normalizeTitleKey(title: string): string {
  return stripDiacritics(title)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** RT URL slug: "Marvel's Daredevil" → marvel_s_daredevil */
export function titleToRtSlug(title: string): string {
  return stripDiacritics(title)
    .toLowerCase()
    .replace(/&/g, " and ")
    // Possessive 's becomes _s (RT: marvel_s_daredevil)
    .replace(/([a-z0-9])['']s\b/g, "$1_s")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
}

function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitleKey(a);
  const nb = normalizeTitleKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Strip parenthetical year from RT names: "Shogun (2024)"
  const stripYear = (s: string) => s.replace(/\s+\d{4}$/g, "").trim();
  const na2 = stripYear(na);
  const nb2 = stripYear(nb);
  if (na2 === nb2) return true;
  // Allow "Marvel's Daredevil" vs "Daredevil", "The Office" vs "Office"
  if (na2.endsWith(nb2) || nb2.endsWith(na2)) {
    const longer = na2.length >= nb2.length ? na2 : nb2;
    const shorter = na2.length >= nb2.length ? nb2 : na2;
    // Require the shorter form to be a full word-boundary suffix (not "if" in "what if")
    return (
      shorter.length >= 6 &&
      (longer === shorter ||
        longer.endsWith(" " + shorter) ||
        longer.startsWith(shorter + " "))
    );
  }
  if (na2.startsWith(nb2) || nb2.startsWith(na2)) {
    const longer = na2.length >= nb2.length ? na2 : nb2;
    const shorter = na2.length >= nb2.length ? nb2 : na2;
    return shorter.length >= 5 && longer.startsWith(shorter + " ");
  }
  return false;
}

function candidateSlugs(title: string, year?: string | null): string[] {
  const base = titleToRtSlug(title);
  if (!base) return [];

  // RT sometimes keeps a trailing underscore when the title ends in punctuation
  // ("What If...?" → what_if_). Prefer that before the bare slug so we don't
  // land on a different show ("What/If").
  const punctHeavy = /[.!?…:]/.test(title);
  const bases: string[] = [];
  if (punctHeavy) bases.push(`${base}_`);
  bases.push(base);
  if (!punctHeavy) bases.push(`${base}_`);
  if (base.startsWith("the_")) bases.push(base.slice(4));
  // "Marvel's Daredevil" → marvels_daredevil
  const noPossessive = base.replace(/_s_/g, "s_").replace(/_s$/g, "s");
  if (noPossessive !== base) bases.push(noPossessive);

  // Prefer year-disambiguated slugs first (The Boys 2019, Shogun 2024, …)
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!s || seen.has(s)) return;
    seen.add(s);
    ordered.push(s);
  };

  if (year && /^\d{4}$/.test(year)) {
    for (const s of bases) push(`${s}_${year}`);
  }
  for (const s of bases) push(s);

  return ordered;
}

function parseTomatometer(html: string): {
  score: number | null;
  name: string | null;
  type: string | null;
} {
  const ldMatch = html.match(
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i
  );
  if (!ldMatch) return { score: null, name: null, type: null };

  try {
    const data = JSON.parse(ldMatch[1]) as {
      "@type"?: string;
      name?: string;
      aggregateRating?: { ratingValue?: string | number; name?: string };
    };
    const type = data["@type"] ?? null;
    const name = data.name ?? null;
    const raw = data.aggregateRating?.ratingValue;
    if (raw == null || raw === "") {
      return { score: null, name, type };
    }
    const score = typeof raw === "number" ? raw : Number(String(raw).match(/\d+/)?.[0]);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return { score: null, name, type };
    }
    return { score: Math.round(score), name, type };
  } catch {
    return { score: null, name: null, type: null };
  }
}

async function fetchRtPage(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.rottentomatoes.com/tv/${slug}`, {
      headers: {
        "User-Agent": RT_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.includes("404 - Not Found") || html.includes("Sorry, please try again later")) {
      return null;
    }
    return html;
  } catch {
    return null;
  }
}

/**
 * Look up series Tomatometer by title (and optional first-air year).
 * Tries slug variants against /tv/{slug} and reads schema.org ld+json.
 */
export async function getTvTomatometerFromRt(
  title: string,
  firstAirDate?: string | null
): Promise<RtTvLookupResult> {
  if (!title?.trim()) return { score: null, checked: false };

  const year = firstAirDate?.slice(0, 4) ?? null;
  const slugs = candidateSlugs(title, year);
  let anyPage = false;
  let matchedNoScore = false;

  for (const slug of slugs) {
    const html = await fetchRtPage(slug);
    if (!html) continue;
    anyPage = true;

    const { score, name, type } = parseTomatometer(html);
    // Prefer TVSeries; accept if name matches even when type missing
    const typeOk =
      !type ||
      type === "TVSeries" ||
      type === "TVSeason" ||
      type.toLowerCase().includes("tv");
    if (!typeOk) continue;

    // Prefer a score hit even when the title is only a partial match
    // (e.g. "Shogun" → page "Shogun (2024)").
    const nameOk = !name || titlesMatch(title, name);
    if (!nameOk) continue;

    if (score != null) {
      return { score, checked: true, slug };
    }
    // Page matched but no meter — keep trying year/alt slugs first
    matchedNoScore = true;
  }

  // All slug attempts done: matched a page with no score, or saw pages only
  if (matchedNoScore || anyPage) {
    return { score: null, checked: true };
  }
  // Nothing fetched (network/block) → retry later
  return { score: null, checked: false };
}
