"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import { ShowFollowButton } from "./show-follow-button";
import { MovieWatchButton } from "./movie-watch-button";

type SearchResult = {
  id: number;
  name?: string;
  title?: string;
  poster_path?: string | null;
  first_air_date?: string;
  release_date?: string;
  media_type?: string;
};

/** Module-level cache so remounts still hit recent queries */
const searchCache = new Map<string, SearchResult[]>();
const SEARCH_CACHE_MAX = 20;

function cacheSearchResults(key: string, results: SearchResult[]) {
  if (searchCache.has(key)) searchCache.delete(key);
  searchCache.set(key, results);
  if (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
}

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    const cached = searchCache.get(q);
    if (cached) {
      setResults(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        // Server route uses TMDB_API_KEY (works on Vercel without NEXT_PUBLIC_)
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Search failed");
          setResults([]);
          return;
        }
        const next: SearchResult[] = data.results || [];
        cacheSearchResults(q, next);
        setResults(next);
      } catch (err) {
        console.error("Search failed:", err);
        setError("Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative">
      <div className="flex h-11 w-full items-center gap-3 border-b border-white/15 px-1">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="flex-shrink-0 text-muted-foreground"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          className="w-full bg-transparent text-[15px] text-white placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {focused && (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-card shadow-xl">
          {loading && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Searching…
            </div>
          )}
          {error && !loading && (
            <div className="p-4 text-center text-sm text-red-400">{error}</div>
          )}
          {!loading &&
            !error &&
            results.length === 0 &&
            query.trim().length >= 2 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No results for &quot;{query}&quot;
              </div>
            )}
          {results.map((result) => {
            const isMovie = result.media_type === "movie";
            const title = result.name || result.title || "";
            const year = (
              result.first_air_date ||
              result.release_date ||
              ""
            ).slice(0, 4);
            return (
              <div
                key={`${result.media_type}-${result.id}`}
                className="flex items-center gap-3 border-b border-white/5 p-2 transition-colors hover:bg-secondary"
              >
                <Link
                  href={isMovie ? `/movie/${result.id}` : `/show/${result.id}`}
                >
                  <div className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded bg-secondary">
                    {result.poster_path ? (
                      <Image
                        src={posterUrl(result.poster_path, "w92") ?? ""}
                        alt={title}
                        width={40}
                        height={56}
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                        ?
                      </div>
                    )}
                  </div>
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={isMovie ? `/movie/${result.id}` : `/show/${result.id}`}
                  >
                    <p className="truncate text-sm font-medium text-white">
                      {title}
                    </p>
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {isMovie ? "Movie" : "TV"} {year && `· ${year}`}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  {isMovie ? (
                    <MovieWatchButton
                      tmdbId={result.id}
                      initialStatus={null}
                      compact
                    />
                  ) : (
                    <ShowFollowButton
                      tmdbId={result.id}
                      initialFollowing={false}
                      compact
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
