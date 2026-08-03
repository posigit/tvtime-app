/** Shared Shows/Movies list vs grid preference. */

export const LAYOUT_COOKIE = "tvtime_layout";
export const LAYOUT_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type LayoutPref = "grid" | "list";

export function parseLayoutPref(
  value: string | null | undefined
): LayoutPref | null {
  if (value === "grid" || value === "list") return value;
  return null;
}

/**
 * URL query wins (bookmarks), then cookie, then list default.
 */
export function resolveLayoutPref(
  searchParam: string | null | undefined,
  cookieValue: string | null | undefined
): LayoutPref {
  return (
    parseLayoutPref(searchParam) ??
    parseLayoutPref(cookieValue) ??
    "list"
  );
}

/** Client-side cookie write (path=/, long-lived). */
export function setLayoutCookie(layout: LayoutPref) {
  if (typeof document === "undefined") return;
  document.cookie = `${LAYOUT_COOKIE}=${layout}; path=/; max-age=${LAYOUT_MAX_AGE}; SameSite=Lax`;
}
