/**
 * Single resolver for RT Tomatometer + Popcornmeter + Metacritic.
 *
 * Order:
 *   1) OMDb (Tomatometer + Metacritic) — cheap, needs imdb_id
 *   2) RT title page fallback (/m/ or /tv/) when OMDb has no Tomatometer
 *      (OMDb lags on recent releases; RT itself is authoritative)
 *
 * `checked` means at least one source gave a definitive answer (even
 * "no score exists"), so callers can stamp rt_checked_at. Transient
 * failures (rate limit, network, block) leave checked=false → retry.
 */

import { getOmdbScores } from "./omdb";
import { getTvTomatometerFromRt } from "./rt-tv";
import { getMovieTomatometerFromRt } from "./rt-movie";
import { getTvExternalIds, getMovieExternalIds } from "./tmdb";

export type ResolvedRtScores = {
  imdbId: string | null;
  /** Tomatometer 0–100 */
  score: number | null;
  /** Popcornmeter 0–100 */
  audienceScore: number | null;
  /** Metacritic 0–100 */
  mcScore: number | null;
  checked: boolean;
};

export async function resolveRtScores(opts: {
  type: "tv" | "movie";
  tmdbId: number;
  imdbId?: string | null;
  title?: string | null;
  /** firstAirDate (tv) or releaseDate (movie) — used for year slugs */
  date?: string | null;
}): Promise<ResolvedRtScores> {
  let imdbId = opts.imdbId ?? null;
  if (!imdbId) {
    const ids =
      opts.type === "tv"
        ? await getTvExternalIds(opts.tmdbId)
        : await getMovieExternalIds(opts.tmdbId);
    imdbId = ids.imdb_id ?? null;
  }

  let score: number | null = null;
  let audienceScore: number | null = null;
  let mcScore: number | null = null;
  let checked = false;

  if (imdbId) {
    const omdb = await getOmdbScores(imdbId);
    score = omdb.rtScore;
    mcScore = omdb.mcScore;
    checked = omdb.checked;
  }

  // RT page fallback: covers "OMDb has no RT entry" (recent releases) and
  // fills the Popcornmeter, which OMDb doesn't expose at all.
  if (score == null || audienceScore == null) {
    const title = opts.title ?? null;
    if (title) {
      const rt =
        opts.type === "tv"
          ? await getTvTomatometerFromRt(title, opts.date)
          : await getMovieTomatometerFromRt(title, opts.date);
      if (score == null && rt.score != null) {
        score = rt.score;
        checked = true;
      }
      if (audienceScore == null && rt.audienceScore != null) {
        audienceScore = rt.audienceScore;
        checked = true;
      } else if (rt.checked) {
        checked = true;
      }
      // rt.checked=false (network/block) → keep whatever OMDb said
    } else if (!imdbId) {
      // No title and no imdb — nothing we can do; don't loop forever
      checked = true;
    }
  }

  return { imdbId, score, audienceScore, mcScore, checked };
}
