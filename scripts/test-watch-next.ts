/**
 * Watch Next membership (fresh drops + 14-day windows).
 * Run: npx tsx scripts/test-watch-next.ts
 */
import assert from "node:assert/strict";
import {
  belongsInWatchNext,
  isFreshEpisodeDrop,
} from "../lib/show-progress";

const premiere = new Date("2027-03-15T12:00:00Z");
const followedEarly = new Date("2026-08-17T12:00:00Z");

assert.equal(isFreshEpisodeDrop("2027-03-15", premiere), true);
assert.equal(isFreshEpisodeDrop("2027-03-01", premiere), true);
assert.equal(isFreshEpisodeDrop("2027-02-28", premiere), false);
assert.equal(isFreshEpisodeDrop("2027-03-16", premiere), false);

// Followed today, premieres next year — on premiere day → Watch Next
assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: null,
    hasWatches: false,
    nextAirDate: "2027-03-15",
    now: premiere,
  }),
  true
);

// Same show, 15 days after premiere still unwatched → dormant
assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: null,
    hasWatches: false,
    nextAirDate: "2027-03-15",
    now: new Date("2027-03-30T12:00:00Z"),
  }),
  false
);

// Caught up months ago, new ep aired today → Watch Next
assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: new Date("2026-12-01T12:00:00Z"),
    hasWatches: true,
    nextAirDate: "2027-03-15",
    now: premiere,
  }),
  true
);

// Mid-season, watched 3 days ago, next ep is old → still Watch Next
assert.equal(
  belongsInWatchNext({
    status: "watching",
    followedAt: followedEarly,
    lastActivityAt: new Date("2027-03-12T12:00:00Z"),
    hasWatches: true,
    nextAirDate: "2027-01-01",
    now: premiere,
  }),
  true
);

// For later never Watch Next, even on premiere day
assert.equal(
  belongsInWatchNext({
    status: "for_later",
    followedAt: followedEarly,
    lastActivityAt: null,
    hasWatches: false,
    nextAirDate: "2027-03-15",
    now: premiere,
  }),
  false
);

console.log("watch-next: all assertions passed");
