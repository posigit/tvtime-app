/**
 * Surprise 2-day period seed.
 * Run: npx tsx scripts/test-surprise-period.ts
 */
import assert from "node:assert/strict";
import { periodKey, rotationPeriod } from "../lib/surprise-movies";

const t0 = new Date(0);
const t1 = new Date(86_400_000);
const t2 = new Date(2 * 86_400_000);

assert.equal(rotationPeriod(t0), 0);
assert.equal(rotationPeriod(t1), 0);
assert.equal(rotationPeriod(t2), 1);
assert.equal(periodKey(t0), "1970-P0000");
assert.equal(periodKey(new Date("2026-08-12T00:00:00Z")).startsWith("2026-P"), true);

console.log("surprise period: all assertions passed");
