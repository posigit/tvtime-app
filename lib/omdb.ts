const OMDB_BASE_URL = "https://www.omdbapi.com";

function getApiKey(): string | null {
  const key = process.env.OMDB_API_KEY?.trim();
  // Tolerate quotes copied from .env files ("abc123" → abc123)
  return key ? key.replace(/^["']|["']$/g, "") : null;
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

/** OMDb critic scores: Tomatometer + Metacritic in one call. */
export type OmdbScores = {
  rtScore: number | null;
  mcScore: number | null;
  checked: boolean;
};

function parsePercent(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * Fetch the Rotten Tomatoes Tomatometer AND Metacritic Metascore via OMDb.
 * Scores are null when absent from a valid response.
 */
export async function getOmdbScores(imdbId: string): Promise<OmdbScores> {
  const key = getApiKey();
  if (!key || !imdbId) return { rtScore: null, mcScore: null, checked: false };

  try {
    const url = `${OMDB_BASE_URL}/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}`;
    // DB is our cache — do not let Next cache rate-limit / error bodies for a day
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { rtScore: null, mcScore: null, checked: false };

    const data = (await res.json()) as OmdbResponse;
    if (data.Response !== "True") {
      return { rtScore: null, mcScore: null, checked: false };
    }

    const rt = data.Ratings?.find((r) => r.Source === "Rotten Tomatoes");
    const mc = data.Ratings?.find((r) => r.Source === "Metacritic");
    return {
      rtScore: parsePercent(rt?.Value),
      mcScore: parsePercent(mc?.Value),
      checked: true,
    };
  } catch {
    return { rtScore: null, mcScore: null, checked: false };
  }
}

/**
 * Fetch the Rotten Tomatoes Tomatometer for a title via OMDb.
 * Returns e.g. 96 for "96%", or null score when RT is absent from a valid response.
 */
export async function getRottenTomatoesScore(
  imdbId: string
): Promise<RtLookupResult> {
  const { rtScore, checked } = await getOmdbScores(imdbId);
  return { score: rtScore, checked };
}

/** True when `rt_score` is a real Tomatometer (0–100). `-1` means "checked, no RT". */
export function isDisplayableRtScore(
  score: number | null | undefined
): score is number {
  return score != null && score >= 0;
}
