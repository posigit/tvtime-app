# Surprise Me pool — refresh every 2 days instead of weekly

Date: 2026-08-10 · Status: PLAN (no code changed)

## The sharp take

Chronologically refreshing every 2 days is **almost useless alone**. The pool
build is **seeded by the ISO week number**, not by the calendar day. Within the
same week, every rebuild produces the *identical* pool. Mon/Wed/Fri runs of
week W33 would all generate the same ~293 movies. That's the fake-rotation bug
again, just at a faster cadence.

To actually rotate every 2 days you must change the **seed**, not just the
cron. One-string change in the seed = real rotation on every run.

## Why it's deterministic today

- `rebuildSurprisePool()` (lib/surprise-movies.ts:229) calls
  `isoWeekKey()` → "2026-W33".
- `poolSlices(weekKey)` derives `w = weekNumber(weekKey)` and rotates on it:
  - sort axis: `SORTS[w % 5]`
  - genre offset: `(w * 2) % 12` (3 of 12 genres per run)
  - deep page: `1 + ((w * 7 + n) % 12)`
- Result: same `w` → same slices → same pool. Re-run within a week = no-op
  visually. This is the documented "didn't rotate this morning" trap, and it
  applies to ANY intra-week re-trigger.

## The change — 2 files, ~4 lines

### 1. `lib/surprise-movies.ts` — rotate on a 2-day period, not the ISO week

Add a period key: number of 2-day periods since an epoch.

```ts
/** 2-day rotation period, e.g. 183 → pool content changes every 2 days. */
export function rotationPeriod(date = new Date()): number {
  return Math.floor(date.getTime() / 86_400_000 / 2);
}
```

In `rebuildSurprisePool()` (line ~229) replace the seed + label:

```ts
const period = rotationPeriod();
const week = `2026-P${String(period).padStart(3, "0")}`; // label is cosmetic
```

and keep passing `week` into `poolSlices` — NO other change needed:
`poolSlices` only calls `weekNumber(weekKey)` which regexes the trailing
number (`/-W(\d+)$/`)… **note**: update that regex to `/-P(\d+)$/` (or generic
`/-(\d+)$/`) so the new label still parses. Everything downstream
(dedupe, insert, read) is seed-agnostic.

The `week` column value is **cosmetic only** — `getUnseenGreatMoviesPool`
reads ALL rows with no week filter (verified in source). The label just needs
to change on each run so the verification log proves rotation.

### 2. `.github/workflows/weekly-refresh.yml` — cron `0 0 */2 * *`

`"0 0 * * 5"` (Fri 00:00 UTC) → `"0 0 */2 * *"` (00:00 UTC every odd DOM:
1,3,5…29,31). ~01:00 WAT. That's the standard "every 2 days" cron.

Keep `workflow_dispatch` — you'll re-trigger manually often (like today).

## Side effects to accept

1. **RT sweep also runs every 2 days** — `runWeeklyRefresh` does BOTH the RT
   score sweep and the pool rebuild. 3.5× more RT resolves + TMDB discover
   calls. Bounded batch (150 default, max 400) so it's cheap; net upside (fresher
   scores). If you want a *light* 2-day run, splitting surprise-only out of the
   job is a bigger change — skip unless the RT sweep ever becomes a problem.
2. **Pinned movies die in 2 days, not 5.** The Favourite (pinned today) is
   wiped on the first rebuild after this ships… which is Friday if we keep the
   current cadence, or ~2 days after the first 2-day run. For the screenshot
   that's fine — but if pins should SURVIVE rebuilds, that needs the pin merge
   (below).
3. **TMDB/movie counts drift more often** — pool size changes each run
   (293 today). Expected; that's the point.

## Optional (only if pins must survive rebuilds)

Add a `surprise_pins` merge in `rebuildSurprisePool()` **after** the
delete+insert: read pinned tmdbIds (`surprise_pins` table, or a hardcoded
array), fetch TMDB details, insert them back. ~15 lines. This is the feature
that makes "always show X in Surprise" permanent. **Skipped for now** — the
screenshot only needs a 5-hour pin, and he said no code change for it.

## Verification (post-change)

1. Deploy the code change (push master → Vercel).
2. Dispatch the workflow: `gh workflow run weekly-refresh.yml`.
3. Read the log: `gh run view <id> --log | grep -oE '"surprise":\{[^}]+\}'`
   → expect `{"week":"2026-P183","count":N}` where N differs from 293
   (proof the new seed ran, not cached).
4. Confirm the label changes on the NEXT dispatch 2 days later (different N,
   different `P` period).
5. App check: refresh movies tab → grid visibly different from today.

## Concrete diffs (for execution time)

- `lib/surprise-movies.ts`:
  - add `rotationPeriod()`
  - `rebuildSurprisePool()`: `const period = rotationPeriod(); const week =
    \`2026-P${String(period).padStart(3, "0")}\`;` then pass `week` to
    `poolSlices`/insert as today
  - `weekNumber()` regex: `/-W(\d+)$/` → `/-(\d+)$/`
- `.github/workflows/weekly-refresh.yml`: cron `0 0 */2 * *` + comment update
- No schema change, no drizzle push needed (week is a text col, already there)

## Follow-up decision needed from Posi

- **Cadence**: every 2 days (`0 0 */2 * *`, odd days) — or every 3 days /
  Mon-Wed-Fri fixed days? `*/2` is the default I'd ship.
- **Pins**: screenshot-only (die first rebuild) or permanent pins (ship the
  ~15-line merge with this)? My call: screenshot-only — don't bloat this.