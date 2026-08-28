import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { posterUrl, type TmdbMediaCard } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

function RankNum({
  rank,
  gold,
  className,
}: {
  rank: number;
  gold?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "top-ten-rank pointer-events-none select-none",
        gold && "top-ten-rank-gold",
        className
      )}
      aria-hidden
    >
      {rank}
    </span>
  );
}

export function TopTenRail({
  label,
  kicker = "This week",
  href,
  items,
  ownedIds,
  priority = false,
  featured = false,
}: {
  label: string;
  kicker?: string;
  href: string;
  items: TmdbMediaCard[];
  ownedIds?: Set<number>;
  priority?: boolean;
  featured?: boolean;
}) {
  if (items.length === 0) return null;
  const chart = items.slice(0, 10);

  return (
    <section
      className={cn(
        "relative mb-8",
        featured &&
          "-mx-4 mb-9 overflow-hidden border-y border-primary/20 bg-gradient-to-b from-primary/[0.09] via-black to-black px-4 pb-5 pt-5"
      )}
    >
      {featured && (
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl"
          aria-hidden
        />
      )}

      <Link
        href={href}
        className="relative mb-4 flex items-end justify-between gap-3 active:opacity-80"
      >
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
            {kicker}
          </p>
          <h2
            className={cn(
              "mt-1 font-black tracking-tight text-white",
              featured ? "text-[1.85rem] leading-none" : "text-xl leading-tight"
            )}
          >
            {label}
          </h2>
        </div>
        <span className="mb-0.5 inline-flex flex-shrink-0 items-center gap-0.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-black">
          See all
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      </Link>

      <div
        className="-mx-4 flex snap-x snap-mandatory gap-0 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {chart.map((item, i) => {
          const rank = i + 1;
          const first = rank === 1;
          const detailHref =
            item.mediaType === "tv" ? `/show/${item.id}` : `/movie/${item.id}`;
          const owned = ownedIds?.has(item.id);
          const posterW = featured
            ? first
              ? "w-[8.15rem]"
              : "w-[6.85rem]"
            : first
              ? "w-[7.1rem]"
              : "w-[6.2rem]";

          return (
            <Link
              key={`${item.mediaType}-${item.id}`}
              href={detailHref}
              className={cn(
                "relative flex flex-shrink-0 snap-start items-end",
                featured
                  ? first
                    ? "w-[11.25rem]"
                    : "w-[9.6rem]"
                  : first
                    ? "w-[10rem]"
                    : "w-[8.7rem]"
              )}
            >
              <RankNum
                rank={rank}
                gold={first}
                className={cn(
                  "absolute bottom-7 left-0 z-0",
                  first
                    ? featured
                      ? "text-[7.25rem]"
                      : "text-[6.1rem]"
                    : rank === 10
                      ? "text-[4.4rem]"
                      : featured
                        ? "text-[5.6rem]"
                        : "text-[5rem]"
                )}
              />
              <div
                className={cn(
                  "relative z-10 mb-0 ml-[2.35rem] overflow-hidden rounded-xl bg-card shadow-[0_12px_28px_rgba(0,0,0,0.55)] ring-1",
                  first ? "ring-primary/50" : "ring-white/12",
                  posterW
                )}
              >
                <div
                  style={{ aspectRatio: "2 / 3" }}
                  className="relative bg-secondary"
                >
                  {item.poster_path ? (
                    <Image
                      src={posterUrl(item.poster_path, "w342") ?? ""}
                      alt=""
                      fill
                      sizes={first ? "130px" : "110px"}
                      className="object-cover"
                      priority={priority && i < 2}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-1.5 text-center text-[10px] text-muted-foreground">
                      {item.title}
                    </div>
                  )}
                  {owned && (
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[8px] font-bold uppercase text-primary">
                      In library
                    </span>
                  )}
                </div>
              </div>
              <span className="sr-only">
                #{rank} {item.title}
              </span>
            </Link>
          );
        })}
        <Link
          href={href}
          className="mb-1 ml-1 flex w-[4.5rem] flex-shrink-0 snap-end flex-col items-center justify-center gap-1 self-center rounded-xl bg-white/5 py-8 text-center ring-1 ring-white/10"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-black">
            <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="text-[10px] font-black uppercase tracking-wide text-white/80">
            Full
            <br />
            list
          </span>
        </Link>
      </div>
    </section>
  );
}
