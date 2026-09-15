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
 *   npx tsx scripts/imdb-year-rankings.ts 2026 --min-votes 500 --limit 100
 *   npx tsx scripts/imdb-year-rankings.ts --decade 1990s
 *
 * Output: data/imdb-rankings/year-2026.json (or decade-1990s.json)
 *   [{ tconst, title, year, rating, votes, score }]
 * score = Bayesian-weighted (IMDb Top-250 formula):
 *   (v/(v+m))*R + (m/(v+m))*C  — kills 50-vote 9.1s floating above real films.
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

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let years: number[] = [];
  // 10K floor: kills regional vote blocs (2–16K votes at 9.x) while keeping
  // every film with genuine global footprint. Validated on 2026 data —
  // Odyssey #2 (493K), Hail Mary #3 (545K). Lower only for sparse early years.
  let minVotes = 10000;
  let limit = 200;
  let tag = "";

  const decadeArg = args.find((a) => a.startsWith("--decade"));
  if (decadeArg) {
    const raw =
      decadeArg.split("=")[1] ?? args[args.indexOf(decadeArg) + 1] ?? "";
    const m = raw.match(/(\d{4})s?/);
    if (!m) throw new Error(`Bad --decade value: ${raw} (want e.g. 1990s)`);
    const start = Math.floor(Number(m[1]) / 10) * 10;
    years = Array.from({ length: 10 }, (_, i) => start + i);
    tag = `decade-${start}s`;
  } else {
    const y = Number(args.find((a) => /^\d{4}$/.test(a)));
    if (!y) throw new Error("Usage: imdb-year-rankings.ts <year> | --decade <1990s>");
    years = [y];
    tag = `year-${y}`;
  }

  const mv = args.find((a) => a.startsWith("--min-votes"));
  if (mv) minVotes = Number(mv.split("=")[1] ?? args[args.indexOf(mv) + 1]) || 1000;
  const lim = args.find((a) => a.startsWith("--limit"));
  if (lim) limit = Number(lim.split("=")[1] ?? args[args.indexOf(lim) + 1]) || 200;
  return { years, minVotes, limit, tag };
}

async function main() {
  const { years, minVotes, limit, tag } = parseArgs(process.argv);
  const wanted = new Set(years);
  console.log(`IMDb rankings for ${tag} (min ${minVotes} votes)…`);

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

  // Pass 2: ratings — join, filter by votes.
  console.log("  pass 2/2: title.ratings (streaming, nothing saved)…");
  const rows: Array<Omit<Ranked, "score">> = [];
  await streamTsv(RATINGS_URL, (c) => {
    // tconst 0, averageRating 1, numVotes 2
    const b = basics.get(c[0]);
    if (!b) return;
    const votes = Number(c[2]);
    if (!Number.isFinite(votes) || votes < minVotes) return;
    const rating = Number(c[1]);
    if (!Number.isFinite(rating)) return;
    rows.push({ tconst: c[0], title: b.title, year: b.year, rating, votes });
  });
  console.log(`  ${rows.length} films with >= ${minVotes} votes`);

  if (rows.length === 0) {
    console.error("No films matched — lower --min-votes and retry.");
    process.exit(1);
  }

  // Bayesian weight (IMDb Top-250 formula), C = mean of this set.
  const C = rows.reduce((s, r) => s + r.rating, 0) / rows.length;
  const m = minVotes;
  const ranked: Ranked[] = rows
    .map((r) => ({
      ...r,
      score: (r.votes / (r.votes + m)) * r.rating + (m / (r.votes + m)) * C,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const outDir = join(process.cwd(), "data", "imdb-rankings");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${tag}.json`);
  writeFileSync(outPath, JSON.stringify({ tag, mean: +C.toFixed(3), minVotes, items: ranked }, null, 1));
  console.log(`wrote ${outPath} (${ranked.length} films, mean ${C.toFixed(2)})`);
  ranked.slice(0, 15).forEach((r, i) =>
    console.log(`  ${i + 1}. ${r.title} (${r.year}) ${r.rating} / ${r.votes.toLocaleString()} votes → ${r.score.toFixed(3)}`)
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
