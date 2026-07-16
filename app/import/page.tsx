"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { posterUrl } from "@/lib/tmdb";
import { useRouter } from "next/navigation";

type Candidate = {
  tmdbId: number;
  title: string;
  year?: string;
  overview?: string;
  posterPath?: string | null;
  score: number;
};

type Mapping = {
  query: string;
  type: "tv" | "movie";
  tvTimeId?: number;
  candidates: Candidate[];
  selectedTmdbId?: number;
  needsReview: boolean;
};

export default function ImportPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [showMappings, setShowMappings] = useState<Mapping[]>([]);
  const [movieMappings, setMovieMappings] = useState<Mapping[]>([]);
  const [stats, setStats] = useState<{
    shows: number;
    episodeWatches: number;
    movies: number;
    episodeReactions: number;
    movieReactions: number;
    lists: number;
  } | null>(null);

  const startParse = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/import/parse", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setShowMappings(data.showMappings);
      setMovieMappings(data.movieMappings);
      setStats(data.stats);
    } catch (err) {
      alert("Parse failed: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const updateMapping = (type: "tv" | "movie", index: number, tmdbId: number) => {
    if (type === "tv") {
      const next = [...showMappings];
      next[index].selectedTmdbId = tmdbId;
      next[index].needsReview = false;
      setShowMappings(next);
    } else {
      const next = [...movieMappings];
      next[index].selectedTmdbId = tmdbId;
      next[index].needsReview = false;
      setMovieMappings(next);
    }
  };

  const runImport = async () => {
    const unmappedShows = showMappings.filter((m) => !m.selectedTmdbId);
    const unmappedMovies = movieMappings.filter((m) => !m.selectedTmdbId);

    if (unmappedShows.length > 0 || unmappedMovies.length > 0) {
      const proceed = confirm(
        `${unmappedShows.length} shows and ${unmappedMovies.length} movies are not mapped. They will be skipped. Proceed?`
      );
      if (!proceed) return;
    }

    setRunning(true);
    try {
      const res = await fetch("/api/import/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showMappings, movieMappings }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      alert("Import complete!");
      router.push("/shows");
    } catch (err) {
      alert("Import failed: " + (err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const needsReviewCount = showMappings.filter((m) => m.needsReview).length + movieMappings.filter((m) => m.needsReview).length;

  return (
    <div className="min-h-screen bg-black p-4 pb-24 text-white">
      <h1 className="mb-4 text-2xl font-bold">Import TV Time Data</h1>

      {!stats && (
        <Button
          onClick={startParse}
          disabled={loading}
          className="w-full bg-primary text-black hover:bg-primary/90"
        >
          {loading ? "Parsing & Mapping..." : "Start Import"}
        </Button>
      )}

      {stats && (
        <div className="mb-6 space-y-2 rounded-xl bg-card p-4">
          <p>Shows: {stats.shows}</p>
          <p>Episode watches: {stats.episodeWatches}</p>
          <p>Movies: {stats.movies}</p>
          <p>Episode reactions: {stats.episodeReactions}</p>
          <p>Movie reactions: {stats.movieReactions}</p>
          <p>Lists: {stats.lists}</p>
          {needsReviewCount > 0 && (
            <p className="text-primary">{needsReviewCount} items need review</p>
          )}
        </div>
      )}

      {showMappings.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Shows ({showMappings.length})</h2>
          <div className="space-y-4">
            {showMappings.map((mapping, idx) => (
              <MappingCard
                key={idx}
                mapping={mapping}
                onSelect={(tmdbId) => updateMapping("tv", idx, tmdbId)}
              />
            ))}
          </div>
        </div>
      )}

      {movieMappings.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Movies ({movieMappings.length})</h2>
          <div className="space-y-4">
            {movieMappings.map((mapping, idx) => (
              <MappingCard
                key={idx}
                mapping={mapping}
                onSelect={(tmdbId) => updateMapping("movie", idx, tmdbId)}
              />
            ))}
          </div>
        </div>
      )}

      {stats && (
        <Button
          onClick={runImport}
          disabled={running}
          className="w-full bg-primary text-black hover:bg-primary/90"
        >
          {running ? "Importing..." : "Run Import"}
        </Button>
      )}
    </div>
  );
}

function MappingCard({
  mapping,
  onSelect,
}: {
  mapping: Mapping;
  onSelect: (tmdbId: number) => void;
}) {
  const [manualId, setManualId] = useState("");

  return (
    <div className={`rounded-xl bg-card p-4 ${mapping.needsReview ? "ring-1 ring-primary" : ""}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold">{mapping.query}</p>
          <p className="text-sm text-muted-foreground">
            {mapping.needsReview ? "Needs review" : "Mapped"}
          </p>
        </div>
        {mapping.selectedTmdbId && (
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-black">
            TMDB: {mapping.selectedTmdbId}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {mapping.candidates.map((candidate) => (
          <button
            key={candidate.tmdbId}
            onClick={() => onSelect(candidate.tmdbId)}
            className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors ${
              mapping.selectedTmdbId === candidate.tmdbId
                ? "bg-primary/20 ring-1 ring-primary"
                : "bg-secondary hover:bg-muted"
            }`}
          >
            <div className="relative h-16 w-12 flex-shrink-0 overflow-hidden rounded bg-muted">
              {candidate.posterPath ? (
                <Image
                  src={posterUrl(candidate.posterPath, "w92") || ""}
                  alt={candidate.title}
                  width={48}
                  height={64}
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  No img
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{candidate.title}</p>
              <p className="text-sm text-muted-foreground">
                {candidate.year ? candidate.year.slice(0, 4) : "Unknown year"} · Score: {Math.round(candidate.score)}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <Input
          placeholder="Manual TMDB ID"
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          className="h-10 border-white/10 bg-secondary text-white"
        />
        <Button
          onClick={() => {
            const id = Number(manualId);
            if (id) onSelect(id);
          }}
          className="bg-muted text-white hover:bg-muted"
        >
          Set
        </Button>
      </div>
    </div>
  );
}
