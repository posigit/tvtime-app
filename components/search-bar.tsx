"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://api.themoviedb.org/3/search/multi?api_key=${process.env.NEXT_PUBLIC_TMDB_API_KEY || ""}&query=${encodeURIComponent(query)}`
        );
        const data = await res.json();
        setResults(
          (data.results || [])
            .filter((r: SearchResult) => r.media_type === "tv" || r.media_type === "movie")
            .slice(0, 10)
        );
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search shows and movies..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        className="h-12 w-full rounded-xl border border-white/10 bg-card px-4 text-white placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />

      {focused && (
        <div className="absolute left-0 right-0 top-14 z-50 max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-card shadow-xl">
          {results.length === 0 && query.trim().length >= 2 && !loading && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No results for &quot;{query}&quot;
            </div>
          )}
          {results.map((result) => {
            const isMovie = result.media_type === "movie";
            const title = result.name || result.title || "";
            const year = (result.first_air_date || result.release_date || "").slice(0, 4);
            return (
              <div
                key={`${result.media_type}-${result.id}`}
                className="flex items-center gap-3 border-b border-white/5 p-2 transition-colors hover:bg-secondary"
              >
                <Link href={isMovie ? `/movie/${result.id}` : `/show/${result.id}`}>
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
                  <Link href={isMovie ? `/movie/${result.id}` : `/show/${result.id}`}>
                    <p className="truncate text-sm font-medium text-white">{title}</p>
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {isMovie ? "Movie" : "TV"} {year && `· ${year}`}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  {isMovie ? (
                    <MovieWatchButton tmdbId={result.id} initialStatus={null} compact />
                  ) : (
                    <ShowFollowButton tmdbId={result.id} initialFollowing={false} compact />
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
