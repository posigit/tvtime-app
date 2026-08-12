# Exact-time alerts, dual subtitle sources, resume UI, rewatch visibility

> **Plan mode (rev 2)** — user decisions folded in: VDRK **and** OpenSubtitles both available as user-pickable sources (VDRK alone isn't always correct), OpenSubtitles key already set on prod, resume button UI needs a taste-driven redesign, rewatch counts visible for movies too.

## 1. Subtitles — dual-source picker (VDRK + OpenSubtitles), no longer auto-only
**Problem:** today VDRK auto-loads when the stream lacks English CC; OS only fires if VDRK fails. User wants **both available in a chooser** because VDRK quality varies.

**Plan (UI + small lib, no schema):**
1. Add a **CC/subtitle button** to the player's top control bar (next to speed/source), opening a picker:
   - **Off**
   - **Stream CC** (hls subtitle tracks, when present)
   - **VDRK English** (manual load of `cache.vdrk.site` VTT for current item)
   - **OpenSubtitles English** (manual load via existing `/api/vixsrc/subs`, key already in prod env)
2. Picker writes `saveVixSettings({ subs })` (existing persistence + server sync) and triggers the chosen load path. Selecting a source re-runs `maybeLoadFallbackSubtitles`-style logic for that source.
3. Auto-fallback stays as last-resort default (VDRK → OS) when user hasn't chosen, but once a user picks, the picker wins.
4. Banned-language clamp intact (Italian never).

**Cost:** ~180 lines player UI + small wiring. Highest value of the batch.

## 2. Resume affordance on detail page — taste-driven redesign
**Current:** `Resume · 12m left` is a bare 11px gold `<p>` inside the episode row — text, not a control, easy to miss, no hierarchy.

**Design target (matches page language):** dark card surfaces + gold `#f5c518` accent + pill radius. Adopt the ElevenLabs **restrained pill + layered subtle shadow** philosophy, adapted to the app's dark theme:
- Replace the plain text with a **compact pill chip**: `▶ Resume · 12m left` — gold-tinted (`bg-primary/15`, `text-primary`, ring `ring-primary/30`), 9999px radius, ~20px tall, `text-xs font-bold`.
- Tap on chip = `openPlayer(ep)` (same as play button) — with `autoResume` already handled by the player overlay.
- Keeps the row layout: chip sits under the episode title line, replaces the current text; no layout shift (same `mt-0.5` slot).
- Micro-interaction: `active:scale-95` like other buttons; focus ring.

**Cost:** ~15 lines (single className swap + onClick). Pure polish.

## 3. Rewatch counts — visible everywhere, movies included
1. **TV season row:** when `rewatchCount > 0`, render passive **`Rewatch ×N`** pill beside `watchedCount/total` (green `bg-success/15 text-success`), always visible, no tap needed. Badge button stays as the trigger.
2. **TV series:** same pill on the More menu row (already has ×N — keep, but add a **header pill** next to the show title when series count > 0).
3. **Movie:** already has `↻ ×N` button when watched — upgrade to **icon + count label** (`↻ ×2`) so it reads at a glance; keep tap = rewatch dialog.
4. Reuses existing `rewatchCounts` / `movieRewatchCount` data — no API/schema changes.

**Cost:** ~40 lines.

## 4. Exact-time episode alerts — HOLD (feasibility walls)
Still blocked by the two walls from rev 1: TMDB has **no air time** (date only), and **Vercel Hobby cron = once/day**. **Not building this round.** Revisit only if you (a) upgrade Vercel to Pro AND (b) accept per-show manual air times (Option C) or TVDB integration.

## Build order
1. Subtitles dual-source picker (biggest value)
2. Resume chip (quick polish)
3. Rewatch visibility pills (quick)
4. Alerts — parked unless you say otherwise

## Verification
- tsc/lint/build green → commit → subagent verify → push (locked workflow).
- Manual: pick VDRK vs OS on a show with both; confirm picker wins over auto; resume chip opens player with autoResume; ×N pills render on TV season rows + movie button.
