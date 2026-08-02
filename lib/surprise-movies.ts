import {
  discoverGreatMovies,
  getTopRatedMoviesPage,
  type TmdbMovieCard,
} from "./tmdb";

export type SurpriseMovie = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  rtScore: number | null;
  rating?: number | null;
  voteAverage?: number | null;
  badge?: string;
};

function toSurprise(card: TmdbMovieCard, badge: string): SurpriseMovie {
  return {
    tmdbId: card.id,
    title: card.title,
    posterPath: card.poster_path ?? null,
    releaseDate: card.release_date ?? null,
    runtime: null,
    rtScore: null,
    voteAverage: card.vote_average ?? null,
    badge,
  };
}

/**
 * Build a pool of top-rated / classic films the user has not watched
 * (and ideally not already in their library).
 *
 * Sources:
 *  - TMDB Top Rated (pages 1–5)
 *  - Discover: highly rated with big vote counts
 *  - Discover classics: same bar, released before ~2000
 */
export async function getUnseenGreatMoviesPool(
  excludeIds: Set<number>
): Promise<SurpriseMovie[]> {
  const [
    top1,
    top2,
    top3,
    top4,
    top5,
    great1,
    great2,
    classics1,
    classics2,
  ] = await Promise.all([
    getTopRatedMoviesPage(1).catch(() => [] as TmdbMovieCard[]),
    getTopRatedMoviesPage(2).catch(() => [] as TmdbMovieCard[]),
    getTopRatedMoviesPage(3).catch(() => [] as TmdbMovieCard[]),
    getTopRatedMoviesPage(4).catch(() => [] as TmdbMovieCard[]),
    getTopRatedMoviesPage(5).catch(() => [] as TmdbMovieCard[]),
    discoverGreatMovies(1).catch(() => [] as TmdbMovieCard[]),
    discoverGreatMovies(2).catch(() => [] as TmdbMovieCard[]),
    discoverGreatMovies(1, { maxYear: 1999, minVoteAverage: 7.8 }).catch(
      () => [] as TmdbMovieCard[]
    ),
    discoverGreatMovies(2, { maxYear: 1999, minVoteAverage: 7.8 }).catch(
      () => [] as TmdbMovieCard[]
    ),
  ]);

  const tagged: { card: TmdbMovieCard; badge: string }[] = [
    ...[...top1, ...top2, ...top3, ...top4, ...top5].map((card) => ({
      card,
      badge: "Top rated",
    })),
    ...[...great1, ...great2].map((card) => ({
      card,
      badge: "Critically acclaimed",
    })),
    ...[...classics1, ...classics2].map((card) => ({
      card,
      badge: "Classic",
    })),
  ];

  const seen = new Set<number>();
  const out: SurpriseMovie[] = [];

  for (const { card, badge } of tagged) {
    if (excludeIds.has(card.id) || seen.has(card.id)) continue;
    if (!card.poster_path) continue; // skip blank tiles
    seen.add(card.id);
    out.push(toSurprise(card, badge));
  }

  // Prefer higher scores when order is later used for display; shuffle is random at pick time
  out.sort(
    (a, b) => (b.voteAverage ?? 0) - (a.voteAverage ?? 0) || a.title.localeCompare(b.title)
  );

  return out;
}
