/**
 * Explore digest / tab / ranking helpers.
 * Run: npx tsx scripts/test-explore-digest.ts
 */
import assert from "node:assert/strict";
import {
  dailyPickReason,
  genreIdForName,
  interleaveBuckets,
  mediaKey,
  orderGenreChips,
  pickDailyPick,
} from "../lib/explore-digest";
import { parseExploreTab, resolveExploreTab } from "../lib/explore-tab";
import { rankTopTen } from "../lib/tmdb-list-cache";
import type { TmdbMediaCard } from "../lib/tmdb";

function card(
  id: number,
  extra: Partial<TmdbMediaCard> = {}
): TmdbMediaCard {
  return {
    id,
    title: `Title ${id}`,
    mediaType: "tv",
    ...extra,
  };
}

assert.equal(parseExploreTab("discover"), "discover");
assert.equal(parseExploreTab("nope"), null);
assert.equal(resolveExploreTab(undefined, "discover"), "discover");
assert.equal(resolveExploreTab("feed", "discover"), "feed");
assert.equal(resolveExploreTab(undefined, undefined), "feed");

assert.deepEqual(
  interleaveBuckets<number | string>(
    [
      [1, 2, 3],
      ["a", "b"],
    ],
    5
  ),
  [1, "a", 2, "b", 3]
);
assert.deepEqual(interleaveBuckets([[], [1]], 3), [1]);

const mixed = [
  card(1),
  card(2, { overview: "A show" }),
  card(3, { backdrop_path: "/x.jpg" }),
];
assert.equal(pickDailyPick(mixed)?.id, 2);
assert.equal(pickDailyPick([]), null);

assert.equal(
  dailyPickReason({ seedTitle: "The Bear" }),
  "Because you watched The Bear"
);
assert.equal(
  dailyPickReason({ genre: "Crime" }),
  "You watch a lot of Crime"
);
assert.equal(dailyPickReason({}), "Picked for you today");

assert.equal(genreIdForName("Crime", "tv"), 80);
assert.equal(genreIdForName("Science Fiction", "movie"), 878);
assert.equal(genreIdForName("nope", "tv"), null);

const chips = [
  { label: "TV · Drama", key: "d" },
  { label: "TV · Crime", key: "c" },
  { label: "Film · Action", key: "a" },
];
assert.deepEqual(
  orderGenreChips(chips, ["Crime", "Action"]).map((c) => c.key),
  ["c", "a", "d"]
);

assert.equal(mediaKey({ mediaType: "movie", id: 9 }), "movie:9");

const ranked = rankTopTen(
  [card(1), card(1), card(2), card(3)],
  2
);
assert.equal(ranked.length, 2);
assert.deepEqual(
  ranked.map((r) => r.id),
  [1, 2]
);

console.log("explore digest: all assertions passed");
