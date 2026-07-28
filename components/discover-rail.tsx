import Link from "next/link";
import Image from "next/image";
import { posterUrl, type TmdbMediaCard } from "@/lib/tmdb";
import { SectionLabel } from "@/components/section-label";

export function DiscoverRail({
  label,
  items,
}: {
  label: string;
  items: TmdbMediaCard[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3">
        <SectionLabel>{label}</SectionLabel>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {items.map((item) => {
          const href =
            item.mediaType === "tv"
              ? `/show/${item.id}`
              : `/movie/${item.id}`;
          return (
            <Link
              key={`${item.mediaType}-${item.id}`}
              href={href}
              className="w-28 flex-shrink-0 overflow-hidden rounded-lg bg-card"
            >
              <div
                style={{ aspectRatio: "2 / 3" }}
                className="relative bg-secondary"
              >
                {item.poster_path ? (
                  <Image
                    src={posterUrl(item.poster_path, "w342") ?? ""}
                    alt={item.title}
                    fill
                    sizes="112px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-muted-foreground">
                    {item.title}
                  </div>
                )}
              </div>
              <p className="truncate px-1.5 py-1 text-[11px] font-medium text-white/90">
                {item.title}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
