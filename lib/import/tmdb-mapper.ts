import { searchMovie, searchTv } from "@/lib/tmdb";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type TmdbMappingResult = {
  query: string;
  type: "tv" | "movie";
  tvTimeId?: number;
  candidates: Array<{
    tmdbId: number;
    title: string;
    year?: string;
    overview?: string;
    posterPath?: string | null;
    score: number;
  }>;
  selectedTmdbId?: number;
  needsReview: boolean;
};

function extractYear(dateString?: string): number | undefined {
  if (!dateString) return undefined;
  const match = dateString.match(/^(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

function extractYearFromTitle(title: string): { cleanTitle: string; year?: number } {
  const match = title.match(/\((\d{4})\)\s*$/);
  if (match) {
    return {
      cleanTitle: title.replace(/\s*\(\d{4}\)\s*$/, "").trim(),
      year: Number(match[1]),
    };
  }
  return { cleanTitle: title };
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  // Simple word overlap
  const wordsA = new Set(na.split(" "));
  const wordsB = nb.split(" ");
  const matches = wordsB.filter((w) => wordsA.has(w)).length;
  return matches / Math.max(wordsA.size, wordsB.length);
}

export async function mapShowsToTmdb(
  shows: Array<{ name: string; tvShowId: number; firstAirDate?: string }>
): Promise<TmdbMappingResult[]> {
  const results: TmdbMappingResult[] = [];

  for (const show of shows) {
    await sleep(50);

    const { cleanTitle, year: titleYear } = extractYearFromTitle(show.name);
    const query = cleanTitle;

    const result: TmdbMappingResult = {
      query: show.name,
      type: "tv",
      tvTimeId: show.tvShowId,
      candidates: [],
      needsReview: true,
    };

    try {
      const searchResult = await searchTv(query);
      const targetYear = titleYear || extractYear(show.firstAirDate);

      result.candidates = searchResult.results.slice(0, 5).map((item) => {
        const year = extractYear(item.first_air_date);
        let score = titleSimilarity(query, item.name) * 100;

        // Boost exact year match
        if (targetYear && year && targetYear === year) {
          score += 30;
        }

        // Boost popularity slightly
        score += Math.min((item.popularity || 0) / 50, 10);

        return {
          tmdbId: item.id,
          title: item.name,
          year: item.first_air_date,
          overview: item.overview,
          posterPath: item.poster_path,
          score,
        };
      });

      // Sort by score descending
      result.candidates.sort((a, b) => b.score - a.score);

      // Auto-select if top candidate is strong
      if (result.candidates.length > 0 && result.candidates[0].score >= 90) {
        result.selectedTmdbId = result.candidates[0].tmdbId;
        result.needsReview = false;
      } else if (result.candidates.length === 1 && result.candidates[0].score >= 70) {
        result.selectedTmdbId = result.candidates[0].tmdbId;
        result.needsReview = false;
      }
    } catch (err) {
      console.error(`Failed to map show "${show.name}":`, err);
    }

    results.push(result);
  }

  return results;
}

export async function mapMoviesToTmdb(
  movies: Array<{ name: string; releaseDate?: string }>
): Promise<TmdbMappingResult[]> {
  const results: TmdbMappingResult[] = [];

  for (const movie of movies) {
    await sleep(50);

    const { cleanTitle, year: titleYear } = extractYearFromTitle(movie.name);
    const query = cleanTitle;

    const result: TmdbMappingResult = {
      query: movie.name,
      type: "movie",
      candidates: [],
      needsReview: true,
    };

    try {
      const searchResult = await searchMovie(query);
      const targetYear = titleYear || extractYear(movie.releaseDate);

      result.candidates = searchResult.results.slice(0, 5).map((item) => {
        const year = extractYear(item.release_date);
        let score = titleSimilarity(query, item.title) * 100;

        if (targetYear && year && targetYear === year) {
          score += 30;
        }

        score += Math.min((item.popularity || 0) / 50, 10);

        return {
          tmdbId: item.id,
          title: item.title,
          year: item.release_date,
          overview: item.overview,
          posterPath: item.poster_path,
          score,
        };
      });

      result.candidates.sort((a, b) => b.score - a.score);

      if (result.candidates.length > 0 && result.candidates[0].score >= 90) {
        result.selectedTmdbId = result.candidates[0].tmdbId;
        result.needsReview = false;
      } else if (result.candidates.length === 1 && result.candidates[0].score >= 70) {
        result.selectedTmdbId = result.candidates[0].tmdbId;
        result.needsReview = false;
      }
    } catch (err) {
      console.error(`Failed to map movie "${movie.name}":`, err);
    }

    results.push(result);
  }

  return results;
}
