import Link from "next/link";
import Image from "next/image";
import { posterUrl, type TmdbMediaCard } from "@/lib/tmdb";
import { SectionLabel } from "@/components/section-label";

export function TopTenRail({
  label,
  items,
  ownedIds,
  priority = false,
}: {
  label: string;
  items: TmdbMediaCard[];
  ownedIds?: Set<number>;
  priority?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="mb-7">
      <div className="mb-3 flex items-baseline justify-between">
        <SectionLabel>{label}</SectionLabel>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          This week
        </p>
      </div>
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.slice(0, 10).map((item, i) => {
          const rank = i + 1;
          const href =
            item.mediaType === "tv" ? `/show/${item.id}` : `/movie/${item.id}`;
          const owned = ownedIds?.has(item.id);

          return (
            <Link
              key={`${item.mediaType}-${item.id}`}
              href={href}
              className="relative flex w-[8.75rem] flex-shrink-0 items-end"
            >
              <span
                className="pointer-events-none absolute -left-1 bottom-7 select-none text-[4.6rem] font-black italic leading-none text-white/[0.14]"
                aria-hidden
              >
                {rank}
              </span>
              <div className="relative ml-7 w-[6.6rem] overflow-hidden rounded-lg bg-card ring-1 ring-white/10">
                <div
                  style={{ aspectRatio: "2 / 3" }}
                  className="relative bg-secondary"
                >
                  {item.poster_path ? (
                    <Image
                      src={posterUrl(item.poster_path, "w342") ?? ""}
                      alt=""
                      fill
                      sizes="106px"
                      className="object-cover"
                      priority={priority && i === 0}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-1.5 text-center text-[10px] text-muted-foreground">
                      {item.title}
                    </div>
                  )}
                  {owned && (
                    <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1 py-0.5 text-[8px] font-bold uppercase text-primary">
                      In library
                    </span>
                  )}
                </div>
                <p className="truncate px-1.5 py-1.5 text-[11px] font-semibold text-white/90">
                  <span className="sr-only">#{rank} </span>
                  {item.title}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
