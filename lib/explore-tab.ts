/**
 * Feed vs Discover persistence for Explore.
 * URL query wins (back-swipe, bookmarks), then cookie, then feed.
 */

export type ExploreTab = "feed" | "discover";

export const EXPLORE_TAB_COOKIE = "tvtime_explore_tab";
export const EXPLORE_TAB_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function parseExploreTab(
  value: string | null | undefined
): ExploreTab | null {
  if (value === "feed" || value === "discover") return value;
  return null;
}

export function resolveExploreTab(
  searchParam: string | null | undefined,
  cookie?: string | null | undefined
): ExploreTab {
  return parseExploreTab(searchParam) ?? parseExploreTab(cookie) ?? "feed";
}

export function setExploreTabCookie(tab: ExploreTab) {
  if (typeof document === "undefined") return;
  document.cookie = `${EXPLORE_TAB_COOKIE}=${tab}; path=/; max-age=${EXPLORE_TAB_MAX_AGE}; SameSite=Lax`;
}
