/**
 * Pure-function checks for player progress helpers.
 * Run: npx tsx scripts/test-player-progress.ts
 */
import assert from "node:assert/strict";
import {
  addStartAt,
  formatPlayerClock,
  isFinishedPosition,
  isNearEndPosition,
  isPreSeekNoise,
  isResumablePosition,
  shouldSaveProgress,
} from "../lib/player-progress";
import { cueTextAt, parseVttCues } from "../lib/player-subs";
import { embedUrlFor } from "../lib/embed-sources";
import { NEXT_FAB_RATIO, RESUME_END_RATIO } from "../lib/player-constants";

assert.equal(isResumablePosition(3, 100), false);
assert.equal(isResumablePosition(10, 100), true);
assert.equal(isResumablePosition(93, 100), false);
assert.equal(isResumablePosition(50, 0), true);

assert.equal(isFinishedPosition(91.9, 100), false);
assert.equal(isFinishedPosition(92, 100), true);
assert.equal(isFinishedPosition(92, 0), false);

assert.equal(isNearEndPosition(95.9, 100, NEXT_FAB_RATIO), false);
assert.equal(isNearEndPosition(96, 100, NEXT_FAB_RATIO), true);

assert.equal(
  shouldSaveProgress({
    pos: 10,
    force: false,
    lastSavedPos: 10,
    lastSavedAt: Date.now(),
  }),
  false
);
assert.equal(
  shouldSaveProgress({
    pos: 10,
    force: true,
    lastSavedPos: 10,
    lastSavedAt: Date.now(),
  }),
  true
);
assert.equal(
  shouldSaveProgress({
    pos: 20,
    force: false,
    lastSavedPos: 10,
    lastSavedAt: Date.now() - 3000,
  }),
  true
);

assert.equal(formatPlayerClock(65), "1:05");
assert.equal(formatPlayerClock(3661), "1:01:01");

// Resume-seek gate: only near-zero reports are noise. 43:00 → 3:00 must save.
assert.equal(isPreSeekNoise(3, 43 * 60), true);
assert.equal(isPreSeekNoise(0, 43 * 60), true);
assert.equal(isPreSeekNoise(6, 43 * 60), true);
assert.equal(isPreSeekNoise(180, 43 * 60), false);
assert.equal(isPreSeekNoise(43 * 60, 43 * 60), false);
assert.equal(isPreSeekNoise(180, null), false);
assert.equal(isPreSeekNoise(180, 0), false);

assert.equal(
  addStartAt("https://cinesrc.st/embed/tv/1?s=1&e=1&controls=false", 109),
  "https://cinesrc.st/embed/tv/1?s=1&e=1&controls=false&t=109&continueprompt=false"
);
assert.equal(
  addStartAt("https://vidfast.vc/movie/1?autoPlay=true", 50),
  "https://vidfast.vc/movie/1?autoPlay=true&startAt=50"
);
// VidNest resumes TV via progress, movies via startAt.
assert.equal(
  addStartAt("https://vidnest.fun/tv/1/2/3?timeslider=hide", 90),
  "https://vidnest.fun/tv/1/2/3?timeslider=hide&progress=90"
);
assert.equal(
  addStartAt("https://vidnest.fun/movie/1?timeslider=hide", 90),
  "https://vidnest.fun/movie/1?timeslider=hide&startAt=90"
);
// Mapple registry follows the official mapple.rip/watch endpoints (TV too).
assert.equal(
  embedUrlFor("mapple", "movie", 1084199),
  "https://mapple.rip/watch/movie/1084199?autoPlay=true"
);
assert.equal(
  embedUrlFor("mapple", "tv", 83867, 1, 1),
  "https://mapple.rip/watch/tv/83867-1-1?autoPlay=true"
);
// VidNest hides its transport chrome by query param.
assert.ok(
  (embedUrlFor("vidnest", "movie", 324857) ?? "").includes("centerplay=hide")
);

const sampleVtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello <b>world</b>

00:01:00.500 --> 00:01:02.000
Line one<br>Line two
`;
const cues = parseVttCues(sampleVtt);
assert.equal(cues.length, 2);
assert.equal(cues[0].text, "Hello world");
assert.equal(cueTextAt(cues, 2), "Hello world");
assert.equal(cueTextAt(cues, 3), "");
assert.equal(cueTextAt(cues, 61), "Line one\nLine two");
// Positive delay pushes cues later.
const delayed = parseVttCues(sampleVtt, 1);
assert.equal(cueTextAt(delayed, 1.5), "");
assert.equal(cueTextAt(delayed, 2.5), "Hello world");

assert.equal(RESUME_END_RATIO, 0.92);
assert.equal(NEXT_FAB_RATIO, 0.96);

console.log("player-progress: all assertions passed");
