/**
 * VIX_RESOLVER_URL validation.
 *
 * A non-empty env var is NOT enough: redacted placeholders (e.g. the literal
 * "[SENSITIVE]" left in .env.vercel) or tunnel URLs pasted with paths would
 * otherwise fail opaquely at fetch time while /api/health reported "configured".
 */

function normalizeBase(raw: string): string | null {
  let base = raw.trim().replace(/\/+$/, "");
  if (!base) return null;
  // Forgive a missing scheme (common paste error: "host.up.railway.app").
  // Resolvers are always https in practice; explicit http:// still honored.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) base = `https://${base}`;
  try {
    const u = new URL(base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname || u.hostname === "[SENSITIVE]") return null;
    return base;
  } catch {
    return null;
  }
}

/**
 * Ordered resolver failover list. VIX_RESOLVER_URLS (comma-separated) wins;
 * legacy single VIX_RESOLVER_URL is appended for back-compat. Invalid entries
 * are dropped (see resolverEnvState for the loud signal).
 */
export function getResolverBases(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined | null) => {
    if (!raw) return;
    for (const part of raw.split(",")) {
      const base = normalizeBase(part);
      if (base && !seen.has(base)) {
        seen.add(base);
        out.push(base);
      }
    }
  };
  push(process.env.VIX_RESOLVER_URLS);
  push(process.env.VIX_RESOLVER_URL);
  return out;
}

export function resolverEnvState(): "unset" | "valid" | "invalid" {
  const raw = [process.env.VIX_RESOLVER_URLS, process.env.VIX_RESOLVER_URL]
    .filter(Boolean)
    .join(",")
    .trim();
  if (!raw) return "unset";
  return getResolverBases().length > 0 ? "valid" : "invalid";
}
