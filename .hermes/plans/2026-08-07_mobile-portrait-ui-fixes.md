# Fix mobile portrait: subtitle picker + profile menu (calendar) dialog

> **Plan mode** — both bugs diagnosed from code. Build + verify + push via locked workflow.

## Bug 3 — Last aired episode: player auto-closes at 92%, no cancel — CONFIRMED BUG

**Root cause (proven):** player auto-completes at 92% (`vix-player.tsx:1221-1229`,
deliberate vixsrc-stall heuristic) → `handlePlayerEvent("ended")`
(`show-detail-client.tsx:405-446`): marks watched, computes `next` (aired +
unwatched + after current). On the last aired episode `next === null` → the
`if (next && autoplayNext)` branch is skipped → falls through to
`setPlayerEp(next ?? null)` = **`setPlayerEp(null)` — player closes at 92%**,
cutting the final 8% of the episode. UpNextCard never renders (requires
`upNext`, which requires `next`), so there's no cancel/message. Reopening
resumes at ~92% → closes again → infinite "keeps auto finishing" loop.

**Fix:**
1. In `handlePlayerEvent`, when `next === null`: **keep the player mounted** —
   do NOT `setPlayerEp(null)`. Set a new `seriesEnded` state instead.
2. New `EndOfLineCard` (or extend UpNextCard with a no-next variant): small
   panel — "That's the latest aired episode — no new episode yet" + Close
   button. Covers both true finales and waiting-for-next-week.
3. Close button reuses the player's existing onClose path (flush + null +
   refresh). Video plays to the true end; user closes when ready.
4. Kills the 92% reopen loop.

## Bug 1 — Profile "⋯" menu (where Calendar lives) is CLIPPED — definitive

**Root cause (proven):** `app/(tabs)/profile/page.tsx:967` — the hero banner is
`relative h-profile-hero w-full overflow-hidden`, and `ProfileMenu` renders
INSIDE it (line 983). The dropdown is `absolute right-0 top-12` (48px below the
button). The hero is only `11rem + safe-area` tall (~176px), and the menu now
has **4 items** (Watch history, Import data, Calendar, Sign out) ≈ 4×44px =
176px+ tall, starting at ~48px → **the bottom of the dropdown is cut off by the
hero's `overflow-hidden`**. Before the Calendar link it was 3 items (~132px) and
only barely clipped; adding the 4th made it clearly broken. Matches the user's
"dialog box has display issues."

**Fix (structural, ~5 lines):** move the ProfileMenu host div
(`absolute right-3 top-safe-float z-20`) OUT of the `overflow-hidden` hero
container, up one level into the outer `relative mb-6` wrapper. Same visual
position (outer wrapper starts at the same spot), but the dropdown now renders
outside the clipping ancestor and shows fully. Verify: 4 items all visible on
mobile portrait.

## Bug 2 — Subtitle picker not responsive on mobile portrait — structural

**Current markup** (`components/vix-player.tsx:1454-1466`):
- Popover is `absolute right-0 top-11 z-30 w-52` (fixed 208px width), anchored
  to a `relative` div wrapping only the CC button, inside the top-controls flex
  row.
- No tap-outside close, no Escape, no scroll close — on mobile the menu stays
  open and is only dismissible by re-tapping CC.

**Failure modes on narrow portrait:**
1. Fixed `w-52` can exceed the viewport or clip text ("Auto (stream → VDRK →
   OS)" wraps/overflows at 208px on small screens).
2. `top-11` fixed offset + long menu (5 options ≈ 220px) can collide with the
   bottom of the screen or the native `controls` bar on short viewports.
3. Anchor is the CC button, which sits mid-row (speed | CC | source | close);
   if the controls row wraps/squeezes on narrow screens the popover can render
   off-viewport.

**Fix:**
1. **Responsive width:** replace `w-52` with
   `min-w-44 max-w-[min(13rem,calc(100vw-2rem))]` so it shrinks on narrow
   screens and never clips text.
2. **Positioning safety:** keep `right-0` (right-aligned is correct near the
   edge) but add `top-full mt-2` instead of hard-coded `top-11` so it tracks
   the button naturally.
3. **Mobile UX:** add a global tap-outside handler + Escape key + close on
   `scroll` while open (mirror ProfileMenu's existing pattern at
   `components/profile-menu.tsx:13-22`). Also `role="menu"` + `aria-label`.
4. If portrait is very short, allow the menu to open upward instead: add
   `max-h-[60vh] overflow-y-auto` to the panel so it can never exceed the
   viewport.

**No API/settings/schema changes.** Pure presentation + event handling.

## Verification
- tsc/lint/build green → commit → subagent verify (mobile-portrait layout
  claims) → push.
- Manual: profile ⋯ shows all 4 items fully; CC picker opens on a 360×740
  viewport without clipping, closes on outside tap/Escape/scroll.
