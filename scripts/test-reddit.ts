/**
 * Reddit listing + row helpers (no network).
 * Run: npx tsx scripts/test-reddit.ts
 */
import assert from "node:assert/strict";
import { listingRows, normalizeRow } from "../lib/reddit";

const arctic = {
  data: [
    {
      id: "abc123",
      title: "Inception discussion",
      selftext: "x".repeat(100),
      permalink: "/r/MovieSuggestions/comments/abc123/inception/",
      created_utc: 1_600_000_000,
      subreddit: "MovieSuggestions",
      score: 120,
      num_comments: 40,
      author: "alice",
    },
    { id: "nsfw1", title: "nsfw", over_18: true, score: 9 },
    { id: "", title: "no id" },
  ],
};
const official = {
  data: {
    children: [
      {
        kind: "t3",
        data: {
          id: "t3_xyz",
          title: "Breaking Bad finale",
          selftext: "",
          permalink: "/r/television/comments/xyz/bb/",
          created_utc: 1_700_000_000,
          subreddit: "television",
          score: 900,
          num_comments: 200,
          author: "[deleted]",
        },
      },
    ],
  },
};

const arcticRows = listingRows(arctic);
assert.equal(arcticRows.length, 3);
const officialRows = listingRows(official);
assert.equal(officialRows.length, 1);

const a = normalizeRow(arcticRows[0]!, "movies");
assert.ok(a);
assert.equal(a.id, "abc123");
assert.equal(a.permalink, "https://www.reddit.com/r/MovieSuggestions/comments/abc123/inception/");
assert.equal(normalizeRow(arcticRows[1]!, "movies"), null);

const o = normalizeRow(officialRows[0]!, "television");
assert.ok(o);
assert.equal(o.id, "xyz");
assert.equal(o.author, "redditor");

assert.deepEqual(listingRows(null), []);
assert.deepEqual(listingRows({}), []);

console.log("reddit helpers: all assertions passed");
