/**
 * Season-progress helper checks.
 * Run: npx tsx scripts/test-show-progress.ts
 */
import assert from "node:assert/strict";
import {
  computeSeasonProgress,
  makeWatchedKey,
  type EpisodeInfo,
} from "../lib/show-progress";

const show = 1;
const ep = (
  season: number,
  num: number,
  airDate: string
): EpisodeInfo => ({
  showTmdbId: show,
  seasonNumber: season,
  episodeNumber: num,
  title: `E${num}`,
  airDate,
});

const now = new Date("2026-08-17T12:00:00Z");
const season3 = [
  ep(3, 1, "2026-08-01"),
  ep(3, 2, "2026-08-08"),
  ep(3, 3, "2026-08-15"),
  ep(3, 4, "2026-08-22"), // unaired
  ep(2, 1, "2026-01-01"),
];

const watched = new Set([makeWatchedKey(3, 1), makeWatchedKey(3, 2)]);
const p = computeSeasonProgress(season3, watched, 3, now);
assert.ok(p);
assert.equal(p.aired, 3);
assert.equal(p.watched, 2);
assert.equal(p.percent, 67);

assert.equal(computeSeasonProgress(season3, watched, 9, now), null);
assert.equal(computeSeasonProgress(season3, watched, 0, now), null);

const none = computeSeasonProgress(season3, new Set(), 3, now);
assert.ok(none);
assert.equal(none.watched, 0);
assert.equal(none.percent, 0);

console.log("show-progress: all assertions passed");
