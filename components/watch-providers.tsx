import Image from "next/image";
import { providerLogoUrl, type WatchProvidersResult } from "@/lib/tmdb";

export function WatchProviders({
  providers,
}: {
  providers: WatchProvidersResult;
}) {
  const stream = providers.flatrate;
  const seen = new Set(stream.map((p) => p.provider_id));
  const others = [...providers.rent, ...providers.buy].filter((p) => {
    if (seen.has(p.provider_id)) return false;
    seen.add(p.provider_id);
    return true;
  });

  if (stream.length === 0 && others.length === 0) return null;

  const reg = (process.env.WATCH_REGION || "US").toUpperCase();

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Where to watch
          <span className="ml-1 text-white/40">({reg})</span>
        </p>
        {providers.link && (
          <a
            href={providers.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-primary"
          >
            JustWatch ↗
          </a>
        )}
      </div>
      {stream.length > 0 && (
        <div className="mb-2">
          <p className="mb-1.5 text-[11px] text-white/50">Stream</p>
          <div className="flex flex-wrap gap-2">
            {stream.map((p) => (
              <ProviderChip
                key={p.provider_id}
                name={p.provider_name}
                logo={p.logo_path}
              />
            ))}
          </div>
        </div>
      )}
      {others.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] text-white/50">Rent / Buy</p>
          <div className="flex flex-wrap gap-2">
            {others.slice(0, 8).map((p) => (
              <ProviderChip
                key={p.provider_id}
                name={p.provider_name}
                logo={p.logo_path}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderChip({
  name,
  logo,
}: {
  name: string;
  logo: string | null;
}) {
  const src = providerLogoUrl(logo);
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg bg-black/40 px-2 py-1"
      title={name}
    >
      {src ? (
        <Image
          src={src}
          alt={name}
          width={28}
          height={28}
          className="rounded-md"
          unoptimized
        />
      ) : null}
      <span className="max-w-[5.5rem] truncate text-[11px] text-white/80">
        {name}
      </span>
    </div>
  );
}
