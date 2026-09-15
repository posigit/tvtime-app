import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { getLibraryState } from "@/lib/explore-digest";
import {
  discoverMoviesByDecade,
  posterUrl,
} from "@/lib/tmdb";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { StickyChrome } from "@/components/sticky-chrome";

const PAGE_SIZE = 20;

function parseDecade(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})s$/);
  const start = Number(m?.[1]);
  const now = new Date().getFullYear();
  if (!Number.isInteger(start) || start % 10 !== 0) return null;
  if (start < 1900 || start > now) return null;
  return start;
}

export default async function DecadePage({
  params,
  searchParams,
}: {
  params: Promise<{ decade: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { decade: raw } = await params;
  const start = parseDecade(raw);
  if (start == null) notFound();

  const { page: rawPage } = await searchParams;
  const pageNum = Math.max(1, Math.min(50, Number(rawPage) || 1));

  const userId = await requireAuth();
  const [{ items, totalPages, totalResults }, library] = await Promise.all([
    discoverMoviesByDecade(start, pageNum).catch(() => ({
      items: [],
      totalPages: 1,
      totalResults: 0,
    })),
    getLibraryState(userId),
  ]);

  const shownPages = Math.min(totalPages, 10);

  return (
    <div className="min-h-dvh bg-black pb-nav-page">
      <StickyChrome contentClassName="px-4 pt-2 pb-2">
        <div className="flex items-center gap-3">
          <Link
            href="/movies"
            aria-label="Back to movies"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">
              Best of the decade
            </p>
            <h1 className="truncate text-lg font-black text-white">
              {start}s
            </h1>
          </div>
        </div>
      </StickyChrome>

      <div className="px-4 pt-3">
        <p className="text-xs font-semibold text-white/40">
          {totalResults > 0
            ? `${totalResults} films ranked by TMDB score`
            : "Top-rated films from this decade"}
        </p>

        {items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Nothing ranked for the {start}s yet — check back later.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-4">
            {items.map((item, i) => {
              const rank = (pageNum - 1) * PAGE_SIZE + i + 1;
              const poster = posterUrl(item.poster_path, "w342");
              const itemYear = item.release_date?.slice(0, 4);
              return (
                <div key={item.id} className="min-w-0">
                  <Link
                    href={`/movie/${item.id}`}
                    className="relative block aspect-[2/3] overflow-hidden rounded-md bg-card ring-1 ring-white/10"
                  >
                    {poster ? (
                      <Image
                        src={poster}
                        alt={item.title}
                        fill
                        sizes="(max-width: 480px) 33vw, 200px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-bold text-white/50">
                        {item.title}
                      </div>
                    )}
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-black text-white backdrop-blur-sm">
                      #{rank}
                    </span>
                  </Link>
                  <Link href={`/movie/${item.id}`} className="mt-1 block min-w-0">
                    <p className="truncate text-xs font-bold text-white">
                      {item.title}
                    </p>
                  </Link>
                  <div className="mt-0.5 flex items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-white/60">
                      <Star className="h-3 w-3 fill-primary text-primary" />
                      {item.vote_average ? item.vote_average.toFixed(1) : "–"}
                      {itemYear ? (
                        <Link
                          href={`/movie/year/${itemYear}`}
                          className="ml-1 text-white/40 underline-offset-2 hover:text-white/80 hover:underline"
                        >
                          {itemYear}
                        </Link>
                      ) : null}
                    </span>
                    <MovieWatchButton
                      tmdbId={item.id}
                      initialStatus={library.movieStatusById.get(item.id) || null}
                      variant="compact"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {shownPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3 pb-8">
            {pageNum > 1 && (
              <Link
                href={`/movie/decade/${start}s?page=${pageNum - 1}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>
            )}
            <span className="text-xs font-bold text-white/60">
              Page {pageNum} of {shownPages}
            </span>
            {pageNum < shownPages && (
              <Link
                href={`/movie/decade/${start}s?page=${pageNum + 1}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"
                aria-label="Next page"
              >
                <ChevronRight className="h-5 w-5" />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
