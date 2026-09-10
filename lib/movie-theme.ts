import sharp from "sharp";

/**
 * Per-movie page theme, sampled from the poster (backdrop fallback).
 *
 * Returns space-separated RGB triplets consumed as CSS vars:
 *   style={{ "--theme": theme.v }} → rgb(var(--theme) / 0.4)
 *
 * Total function — never throws; falls back to brand gold.
 */
export type MovieTheme = {
  /** Vivid accent, e.g. "190 30 25" for a red horror poster. */
  v: string;
  /** Dark wash for page-top gradients. */
  deep: string;
};

export const MOVIE_THEME_FALLBACK: MovieTheme = {
  v: "245 197 24",
  deep: "110 88 10",
};

const THEME_REVALIDATE_S = 60 * 60 * 24 * 30;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s > 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
  ];
}

/**
 * Push a sampled color toward something that reads as a theme on black:
 * near-gray stays an honest warm gray; color gets saturated and clamped
 * to a mid band so glows never go muddy or neon.
 */
function vividify(r: number, g: number, b: number): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.12) {
    const gray = Math.min(0.55, Math.max(0.32, l));
    const v = Math.round(gray * 255);
    return [v, Math.round(v * 0.92), Math.round(v * 0.85)];
  }
  const boosted: [number, number, number] = [
    h,
    Math.min(0.85, Math.max(0.5, s)),
    Math.min(0.6, Math.max(0.36, l)),
  ];
  return hslToRgb(...boosted);
}

async function sampleDominant(url: string): Promise<MovieTheme | null> {
  const res = await fetch(url, {
    next: { revalidate: THEME_REVALIDATE_S },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return null;
  const { dominant } = await sharp(buf).stats();
  const [r, g, b] = vividify(dominant.r, dominant.g, dominant.b);
  return {
    v: `${r} ${g} ${b}`,
    deep: `${Math.round(r * 0.38)} ${Math.round(g * 0.38)} ${Math.round(b * 0.38)}`,
  };
}

export async function getMovieTheme(
  posterPath: string | null | undefined,
  backdropPath: string | null | undefined
): Promise<MovieTheme> {
  const base = "https://image.tmdb.org/t/p";
  const candidates = [
    posterPath ? `${base}/w185${posterPath}` : null,
    backdropPath ? `${base}/w300${backdropPath}` : null,
  ].filter((u): u is string => !!u);

  for (const url of candidates) {
    try {
      const theme = await sampleDominant(url);
      if (theme) return theme;
    } catch {
      // Try the next candidate, fall back to brand gold below.
    }
  }
  return MOVIE_THEME_FALLBACK;
}
