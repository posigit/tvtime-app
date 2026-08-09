/**
 * Shared player thresholds and limits.
 * Keep finish vs near-end jobs separate — do not thrash these week-to-week.
 *
 * 92% → emit "ended": mark watched, clear resume, start 10…0 up-next countdown
 * 96% → onNearEnd: sticky glass Next FAB (after countdown cancel)
 */

/** Positions at/above this fraction count as finished (bookmark cleared). */
export const RESUME_END_RATIO = 0.92;

/** Fire host near-end UI (sticky Next) once past this fraction. */
export const NEXT_FAB_RATIO = 0.96;

/** Ignore resume bookmarks shorter than this (seconds). */
export const RESUME_MIN_SECONDS = 5;

/** Upper bound for position/duration integers in the API. */
export const MAX_PLAYBACK_SECONDS = 2_147_483_647;

/** Min interval between progressive position POSTs (ms). */
export const SAVE_THROTTLE_MS = 2000;

/** Min position delta to bother POSTing (seconds). */
export const SAVE_MIN_DELTA_SECONDS = 1;
