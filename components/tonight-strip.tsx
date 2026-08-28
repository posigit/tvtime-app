import Link from "next/link";
import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";
import { formatEpisodeCode } from "@/lib/playback-format";
import type { TonightItem } from "@/lib/explore-tonight";

export function TonightStrip({ items }: { items: TonightItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <p className="mb-2.5 text-[11px] font-black uppercase tracking-wider text-primary">
        Airing tonight
      </p>
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const code = formatEpisodeCode(item.seasonNumber, item.episodeNumber);
          return (
            <Link
              key={`${item.tmdbId}-${item.seasonNumber}-${item.episodeNumber}`}
              href={`/show/${item.tmdbId}`}
              className="flex w-[13.5rem] flex-shrink-0 items-center gap-2.5 rounded-xl bg-card p-2 ring-1 ring-white/10"
            >
              <div className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded-md bg-secondary">
                {item.posterPath ? (
                  <Image
                    src={posterUrl(item.posterPath, "w185") ?? ""}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-white">
                  {item.title}
                </p>
                <p className="truncate text-[11px] font-semibold text-primary">
                  {code}
                  {item.episodeTitle ? ` · ${item.episodeTitle}` : ""}
                </p>
                <p className="text-[10px] text-muted-foreground">New today</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
