/**
 * Separate list/grid prefs for Shows vs Movies.
 * Cookies: tvtime_layout_shows | tvtime_layout_movies
 */

export type LayoutScope = "shows" | "movies";
export type LayoutPref = "grid" | "list";

export const LAYOUT_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** @deprecated shared cookie — migrated once into scope-specific cookies */
const LEGACY_LAYOUT_COOKIE = "tvtime_layout";

export function layoutCookieName(scope: LayoutScope): string {
  return `tvtime_layout_${scope}`;
}

export function parseLayoutPref(
  value: string | null | undefined
): LayoutPref | null {
  if (value === "grid" || value === "list") return value;
  return null;
}

/**
 * URL query wins (bookmarks), then scope cookie, then legacy shared cookie, then list.
 */
export function resolveLayoutPref(
  searchParam: string | null | undefined,
  scopeCookie: string | null | undefined,
  legacyCookie?: string | null | undefined
): LayoutPref {
  return (
    parseLayoutPref(searchParam) ??
    parseLayoutPref(scopeCookie) ??
    parseLayoutPref(legacyCookie) ??
    "list"
  );
}

/** Client-side cookie write for one scope (path=/, long-lived). */
export function setLayoutCookie(scope: LayoutScope, layout: LayoutPref) {
  if (typeof document === "undefined") return;
  document.cookie = `${layoutCookieName(scope)}=${layout}; path=/; max-age=${LAYOUT_MAX_AGE}; SameSite=Lax`;
}

export { LEGACY_LAYOUT_COOKIE };
