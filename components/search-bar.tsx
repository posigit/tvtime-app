"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  userStatus?: string | null;
  isFollowing?: boolean;
};

/** Module-level cache so remounts still hit recent queries */
const searchCache = new Map<string, SearchResult[]>();
const SEARCH_CACHE_MAX = 20;

const RECENT_SEARCHES_KEY = "tvtime-recent-searches";
const RECENT_MAX = 8;

function readRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(term: string): string[] {
  const t = term.trim();
  if (t.length < 2) return readRecentSearches();
  const next = [t, ...readRecentSearches().filter((s) => s.toLowerCase() !== t.toLowerCase())].slice(
    0,
    RECENT_MAX
  );
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export type SearchTypeFilter = "all" | "movie" | "tv";

function cacheSearchResults(key: string, results: SearchResult[]) {
  if (searchCache.has(key)) searchCache.delete(key);
  searchCache.set(key, results);
  if (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
}

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [searchType, setSearchType] = useState<SearchTypeFilter>("all");
  const [year, setYear] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recents, setRecents] = useState<string[]>([]);

  const cacheKey = (q: string, t: SearchTypeFilter, y: string) =>
    `${t}|${y.trim()}|${q.trim().toLowerCase()}`;

  useEffect(() => {
    const q = query.trim().toLowerCase();
    const y = year.trim();
    if (q.length < 2) {
      // results/error cleared in onChange for short queries
      return;
    }

    // short queries + cache hits resolved in onChange (sync state stays out of effect)
    if (searchCache.has(cacheKey(q, searchType, y))) return;

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        // Server route uses TMDB_API_KEY (works on Vercel without NEXT_PUBLIC_)
        const params = new URLSearchParams({ q: query.trim(), type: searchType });
        if (/^\d{4}$/.test(y)) params.set("year", y);
        const res = await fetch(`/api/search?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Search failed");
          setResults([]);
          return;
        }
        const next: SearchResult[] = data.results || [];
        cacheSearchResults(cacheKey(q, searchType, y), next);
        setResults(next);
        setActiveIndex(-1);
      } catch (err) {
        console.error("Search failed:", err);
        setError("Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, searchType, year]);

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
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            setActiveIndex(-1);
            const t = v.trim().toLowerCase();
            if (t.length < 2) {
              setResults([]);
              setError(null);
              return;
            }
            const cached = searchCache.get(cacheKey(t, searchType, year));
            if (cached) {
              setResults(cached);
              setLoading(false);
              setError(null);
            }
          }}
          onFocus={() => {
            setFocused(true);
            setRecents(readRecentSearches());
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (results.length === 0) return;
              e.preventDefault();
              setActiveIndex((prev) => {
                const next =
                  e.key === "ArrowDown" ? prev + 1 : prev - 1;
                if (next < -1) return results.length - 1;
                if (next >= results.length) return -1;
                return next;
              });
            } else if (e.key === "Enter") {
              if (activeIndex >= 0 && activeIndex < results.length) {
                const r = results[activeIndex]!;
                const href =
                  r.media_type === "movie" ? `/movie/${r.id}` : `/show/${r.id}`;
                setRecents(saveRecentSearch(query));
                setFocused(false);
                router.push(href);
              } else if (query.trim().length >= 2) {
                setRecents(saveRecentSearch(query));
              }
            } else if (e.key === "Escape") {
              setFocused(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          className="w-full bg-transparent text-[15px] text-white placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {focused && (
        <div
          className="absolute left-0 right-0 top-12 z-50 max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-card shadow-xl"
          onMouseDown={(e) => {
            // Keep input focus while tapping pills/year inside (blur would
            // otherwise collapse the dropdown before the tap registers).
            e.preventDefault();
          }}
        >
          <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-2">
            {(["all", "movie", "tv"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setSearchType(t);
                  setActiveIndex(-1);
                }}
                aria-pressed={searchType === t}
                className={
                  searchType === t
                    ? "rounded-full bg-primary px-3 py-1 text-xs font-bold text-black"
                    : "rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/70 hover:bg-white/15 hover:text-white"
                }
              >
                {t === "all" ? "All" : t === "movie" ? "Movies" : "TV"}
              </button>
            ))}
            <input
              value={year}
              onChange={(e) => {
                setYear(e.target.value.replace(/\D/g, "").slice(0, 4));
                setActiveIndex(-1);
              }}
              placeholder="Year"
              inputMode="numeric"
              aria-label="Filter by year"
              className="ml-auto h-7 w-16 rounded-full bg-white/10 px-2.5 text-center text-xs font-semibold text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-primary/60"
            />
          </div>
          {query.trim().length < 2 && recents.length > 0 && (
            <div className="py-1">
              <div className="flex items-center justify-between px-3.5 pb-0.5 pt-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                  Recent
                </p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      window.localStorage.removeItem(RECENT_SEARCHES_KEY);
                    } catch {
                      /* ignore */
                    }
                    setRecents([]);
                  }}
                  className="text-[10px] font-semibold uppercase tracking-wide text-white/40 hover:text-white/70"
                >
                  Clear
                </button>
              </div>
              {recents.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => {
                    setQuery(term);
                    setActiveIndex(-1);
                  }}
                  className="flex w-full items-center px-3.5 py-2 text-left text-sm text-white/80 hover:bg-secondary"
                >
                  <span className="truncate">{term}</span>
                </button>
              ))}
            </div>
          )}
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
          {results.map((result, i) => {
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
                onClick={() => setRecents(saveRecentSearch(query))}
                className={
                  i === activeIndex
                    ? "flex items-center gap-3 border-b border-white/5 bg-secondary p-2 transition-colors"
                    : "flex items-center gap-3 border-b border-white/5 p-2 transition-colors hover:bg-secondary"
                }
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
                      initialStatus={result.userStatus ?? null}
                      variant="compact"
                    />
                  ) : (
                    <ShowFollowButton
                      tmdbId={result.id}
                      initialFollowing={result.isFollowing ?? false}
                      variant="compact"
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
