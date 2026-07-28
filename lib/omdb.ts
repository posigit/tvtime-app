const OMDB_BASE_URL = "https://www.omdbapi.com";

function getApiKey(): string | null {
  return process.env.OMDB_API_KEY || null;
}

type OmdbRating = { Source: string; Value: string };

type OmdbResponse = {
  Response: string;
  Ratings?: OmdbRating[];
  Error?: string;
};

/**
 * Result of an OMDb lookup for Rotten Tomatoes.
 * - `checked: true`  → OMDb answered successfully; `score` is 0–100 or null if no RT entry
 * - `checked: false` → key missing, network/limit/error; caller should retry later
 */
export type RtLookupResult = {
  score: number | null;
  checked: boolean;
};

/**
 * Fetch the Rotten Tomatoes Tomatometer for a title via OMDb.
 * Returns e.g. 96 for "96%", or null score when RT is absent from a valid response.
 */
export async function getRottenTomatoesScore(
  imdbId: string
): Promise<RtLookupResult> {
  const key = getApiKey();
  if (!key || !imdbId) return { score: null, checked: false };

  try {
    const url = `${OMDB_BASE_URL}/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}`;
    // DB is our cache — do not let Next cache rate-limit / error bodies for a day
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { score: null, checked: false };

    const data = (await res.json()) as OmdbResponse;
    if (data.Response !== "True") return { score: null, checked: false };

    const rt = data.Ratings?.find((r) => r.Source === "Rotten Tomatoes");
    if (!rt) return { score: null, checked: true };

    const match = rt.Value.match(/(\d+)/);
    return {
      score: match ? Number(match[1]) : null,
      checked: true,
    };
  } catch {
    return { score: null, checked: false };
  }
}

/** True when `rt_score` is a real Tomatometer (0–100). `-1` means "checked, no RT". */
export function isDisplayableRtScore(
  score: number | null | undefined
): score is number {
  return score != null && score >= 0;
}
