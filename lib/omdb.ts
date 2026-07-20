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
 * Fetch the Rotten Tomatoes Tomatometer for a title via OMDb.
 * Returns e.g. 96 for "96%", or null when unavailable / key missing / error.
 */
export async function getRottenTomatoesScore(
  imdbId: string
): Promise<number | null> {
  const key = getApiKey();
  if (!key || !imdbId) return null;

  try {
    const url = `${OMDB_BASE_URL}/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;

    const data = (await res.json()) as OmdbResponse;
    if (data.Response !== "True" || !data.Ratings) return null;

    const rt = data.Ratings.find((r) => r.Source === "Rotten Tomatoes");
    if (!rt) return null;

    const match = rt.Value.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
