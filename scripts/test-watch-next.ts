/**
 * Watch Next membership (caught-up fresh drops + 14-day windows).
 * Run: npx tsx scripts/test-watch-next.ts
 */
import assert from "node:assert/strict";
import {
  belongsInWatchNext,
  isCaughtUpFreshDrop,
  isFreshEpisodeDrop,
  makeWatchedKey,
  type EpisodeInfo,
} from "../lib/show-progress";

const premiere = new Date("2027-03-15T12:00:00Z");
const followedEarly = new Date("2026-08-17T12:00:00Z");

const ep = (
  season: number,
  num: number,
  airDate: string
): EpisodeInfo => ({
  showTmdbId: 1,
  seasonNumber: season,
  episodeNumber: num,
  title: `S${season}E${num}`,
  airDate,
});

assert.equal(isFreshEpisodeDrop("2027-03-15", premiere), true);
assert.equal(isFreshEpisodeDrop("2027-03-01", premiere), true);
assert.equal(isFreshEpisodeDrop("2027-02-28", premiere), false);
assert.equal(isFreshEpisodeDrop("2027-03-16", premiere), false);

// Necromancer: only S1E1, aired today, never watched
const necro = [ep(1, 1, "2027-03-15")];
assert.equal(isCaughtUpFreshDrop(necro, new Set(), premiere), true);

// Foundation: prior season watched, new S4E1 today
const foundation = [
  ep(3, 1, "2026-01-01"),
  ep(3, 2, "2026-01-08"),
  ep(4, 1, "2027-03-15"),
];
const foundationWatched = new Set([
  makeWatchedKey(3, 1),
  makeWatchedKey(3, 2),
]);
assert.equal(
  isCaughtUpFreshDrop(foundation, foundationWatched, premiere),
  true
);

// Halfway: stopped at S2E4, S3E1 premieres today
const halfway = [
  ep(2, 4, "2026-01-01"),
  ep(2, 5, "2026-01-08"),
  ep(2, 6, "2026-01-15"),
  ep(3, 1, "2027-03-15"),
];
const halfwayWatched = new Set([makeWatchedKey(2, 4)]);
assert.equal(isCaughtUpFreshDrop(halfway, halfwayWatched, premiere), false);

// Ignored S3E1 for 20 days, S3E2 today — not current
const staleNewSeason = [
  ep(3, 1, "2027-02-23"),
  ep(3, 2, "2027-03-15"),
];
assert.equal(
  isCaughtUpFreshDrop(staleNewSeason, new Set(), premiere),
  false
);

// Two fresh eps in the last 14 days, nothing older
const twoFresh = [ep(3, 1, "2027-03-08"), ep(3, 2, "2027-03-15")];
assert.equal(isCaughtUpFreshDrop(twoFresh, new Set(), premiere), true);

assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: null,
    hasWatches: false,
    caughtUpFreshDrop: true,
    now: premiere,
  }),
  true
);

assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: null,
    hasWatches: false,
    caughtUpFreshDrop: false,
    now: premiere,
  }),
  false
);

assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: new Date("2026-12-01T12:00:00Z"),
    hasWatches: true,
    caughtUpFreshDrop: true,
    now: premiere,
  }),
  true
);

assert.equal(
  belongsInWatchNext({
    status: "completed",
    followedAt: followedEarly,
    lastActivityAt: new Date("2026-12-01T12:00:00Z"),
    hasWatches: true,
    caughtUpFreshDrop: true,
    now: premiere,
  }),
  true
);

assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: new Date("2026-12-01T12:00:00Z"),
    hasWatches: true,
    caughtUpFreshDrop: false,
    now: premiere,
  }),
  false
);

assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: new Date("2027-03-12T12:00:00Z"),
    hasWatches: true,
    caughtUpFreshDrop: false,
    now: premiere,
  }),
  true
);

assert.equal(
  belongsInWatchNext({
    status: "for_later",
    followedAt: followedEarly,
    lastActivityAt: null,
    hasWatches: false,
    caughtUpFreshDrop: true,
    now: premiere,
  }),
  false
);

console.log("watch-next: all assertions passed");
