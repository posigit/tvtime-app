/**
 * Fetch year/decade rankings from IMDb's official bulk datasets.
 *
 * Why this exists: IMDb has NO ranking API (no "top 2026 by rating"
 * endpoint). Scraping imdb.com breaks ToS and gets blocked. The only
 * official source is the daily TSV dumps at datasets.imdbws.com.
 *
 * Why streaming: title.basics is ~200MB gz / ~1GB unpacked. This script
 * never writes the dumps to disk — it gunzips over the network and keeps
 * only movies from the requested year(s) in memory. Peak disk = the small
 * output JSON. Safe on Railway or a 10GB-free laptop.
 *
 * Usage:
 *   npx tsx scripts/imdb-year-rankings.ts 2026
 *   npx tsx scripts/imdb-year-rankings.ts --from 1960 --to 2026
 *   npx tsx scripts/imdb-year-rankings.ts --all            # 1960..current year
 *   npx tsx scripts/imdb-year-rankings.ts 2026 --min-votes 500 --limit 100
 *
 * Output: data/imdb-rankings/year-2026.json (one file per year)
 *   { tag, builtAt, mean, minVotes, items:
 *     [{ tconst, title, year, rating, votes, score }] }
 * score = Bayesian-weighted (IMDb Top-250 formula):
 *   (v/(v+m))*R + (m/(v+m))*C  — kills 50-vote 9.1s floating above real films.
 *
 * Vote floor is adaptive per year: starts at --min-votes (default 10K),
 * drops through 5K/2K/1K only when the year can't fill --limit at the
 * higher floor. The effective floor is recorded in the JSON (minVotes).
 * Sparse early years stay full; dense modern years stay clean.
 */
import { get } from "https";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
const BASICS_URL = "https://datasets.imdbws.com/title.basics.tsv.gz";

type BasicsRow = { title: string; year: number };
type Ranked = {
  tconst: string;
  title: string;
  year: number;
  rating: number;
  votes: number;
  score: number;
};

/** Stream a gzipped TSV from URL, one row (split by \t) at a time. */
function streamTsv(
  url: string,
  onRow: (cols: string[], header: string[]) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      const gunzip = createGunzip();
      const rl = createInterface({ input: res.pipe(gunzip) });
      let header: string[] | null = null;
      rl.on("line", (line) => {
        const cols = line.split("\t");
        if (!header) {
          header = cols;
          return;
        }
        onRow(cols, header);
      });
      rl.on("close", () => resolve());
      rl.on("error", reject);
      gunzip.on("error", reject);
    }).on("error", reject);
  });
}

/** Floors tried highest-first; first floor that fills `limit` wins. */
const FLOOR_LADDER = [10000, 5000, 2000, 1000];
const EARLIEST_YEAR = 1960;

function numAfter(args: string[], flag: string): number | undefined {
  const hit = args.find((a) => a.startsWith(flag));
  if (!hit) return undefined;
  const raw = hit.split("=")[1] ?? args[args.indexOf(hit) + 1] ?? "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const now = new Date().getFullYear();
  // 10K floor: kills regional vote blocs (2–16K votes at 9.x) while keeping
  // every film with genuine global footprint. Validated on 2026 data —
  // Odyssey #2 (493K), Hail Mary #3 (545K). Adaptive drop only for sparse years.
  const maxFloor = numAfter(args, "--min-votes") || 10000;
  const limit = numAfter(args, "--limit") || 200;
  let years: number[] = [];

  if (args.includes("--all")) {
    years = Array.from({ length: now - EARLIEST_YEAR + 1 }, (_, i) => EARLIEST_YEAR + i);
  } else {
    const from = numAfter(args, "--from");
    const to = numAfter(args, "--to") ?? now;
    if (from != null) {
      if (from < 1900 || to < from) throw new Error(`Bad --from/--to: ${from}..${to}`);
      years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    } else {
      const y = Number(args.find((a) => /^\d{4}$/.test(a)));
      if (!y) throw new Error("Usage: imdb-year-rankings.ts <year> | --from <y> [--to <y>] | --all");
      years = [y];
    }
  }
  return { years, maxFloor, limit, now };
}

async function main() {
  const { years, maxFloor, limit, now } = parseArgs(process.argv);
  const wanted = new Set(years);
  const floors = [maxFloor, ...FLOOR_LADDER.filter((f) => f < maxFloor)];
  const lo = years[0];
  const hi = years[years.length - 1];
  console.log(
    `IMDb rankings for ${years.length === 1 ? lo : `${lo}..${hi}`} (${years.length} year${years.length === 1 ? "" : "s"}), floor ≤ ${maxFloor.toLocaleString()}, top ${limit}…`
  );

  // Pass 1: basics — keep movies in the wanted years only.
  const basics = new Map<string, BasicsRow>();
  console.log("  pass 1/2: title.basics (streaming, nothing saved)…");
  await streamTsv(BASICS_URL, (c) => {
    // tconst 0, titleType 1, primaryTitle 2, startYear 5
    if (c[1] !== "movie") return;
    const year = Number(c[5]);
    if (!wanted.has(year)) return;
    basics.set(c[0], { title: c[2], year });
  });
  console.log(`  kept ${basics.size} movies from basics`);

  // Pass 2: ratings — join, keep everything at/above the lowest floor.
  // Per-year adaptive selection happens after (floors need full counts).
  const floorMin = Math.min(...floors);
  console.log("  pass 2/2: title.ratings (streaming, nothing saved)…");
  const byYear = new Map<number, Array<Omit<Ranked, "score">>>();
  await streamTsv(RATINGS_URL, (c) => {
    // tconst 0, averageRating 1, numVotes 2
    const b = basics.get(c[0]);
    if (!b) return;
    const votes = Number(c[2]);
    if (!Number.isFinite(votes) || votes < floorMin) return;
    const rating = Number(c[1]);
    if (!Number.isFinite(rating)) return;
    let list = byYear.get(b.year);
    if (!list) {
      list = [];
      byYear.set(b.year, list);
    }
    list.push({ tconst: c[0], title: b.title, year: b.year, rating, votes });
  });
  basics.clear();

  const outDir = join(process.cwd(), "data", "imdb-rankings");
  mkdirSync(outDir, { recursive: true });
  const builtAt = new Date().toISOString();
  let wrote = 0;

  for (const year of years) {
    const tag = `year-${year}`;
    const cands = byYear.get(year) ?? [];
    // Current year never drops: it's the most-visited page and gains votes
    // daily, so a sparse-month dip would regress the ranking (2026 fell to
    // 5K once, letting a 17K-vote anime above Odyssey — never again).
    // Highest floor that still fills `limit` otherwise; sparsest years fall to 1K.
    let floor = year === now ? maxFloor : floors[floors.length - 1];
    if (year !== now) {
      for (const f of floors) {
        if (cands.filter((r) => r.votes >= f).length >= limit) {
          floor = f;
          break;
        }
      }
    }
    const rows = cands.filter((r) => r.votes >= floor);
    if (rows.length === 0) {
      console.log(`  ${tag}: no films ≥ ${floorMin.toLocaleString()} votes — skipped`);
      continue;
    }
    // Bayesian weight (IMDb Top-250 formula), C = mean of this year's set.
    const C = rows.reduce((s, r) => s + r.rating, 0) / rows.length;
    const ranked: Ranked[] = rows
      .map((r) => ({
        ...r,
        score: (r.votes / (r.votes + floor)) * r.rating + (floor / (r.votes + floor)) * C,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const outPath = join(outDir, `${tag}.json`);
    writeFileSync(
      outPath,
      JSON.stringify(
        { tag, builtAt, mean: +C.toFixed(3), minVotes: floor, items: ranked },
        null,
        1
      )
    );
    wrote++;
    const top = ranked[0];
    console.log(
      `  ${tag}: ${ranked.length} films (floor ${floor.toLocaleString()}, mean ${C.toFixed(2)}) → #1 ${top.title} ${top.rating}/${top.votes.toLocaleString()}`
    );
  }
  console.log(`wrote ${wrote}/${years.length} files`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
