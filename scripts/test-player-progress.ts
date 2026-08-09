/**
 * Pure-function checks for player progress helpers.
 * Run: npx tsx scripts/test-player-progress.ts
 */
import assert from "node:assert/strict";
import {
  formatPlayerClock,
  isFinishedPosition,
  isNearEndPosition,
  isResumablePosition,
  shouldSaveProgress,
} from "../lib/player-progress";
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

assert.equal(RESUME_END_RATIO, 0.92);
assert.equal(NEXT_FAB_RATIO, 0.96);

console.log("player-progress: all assertions passed");
