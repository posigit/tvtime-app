# Fix seek regression after source switch (timer frozen, video restarts)

> **Plan mode** — root cause proven from code. Build + verify + push via locked workflow.

## The bug (user report)
"Especially when/after switching servers: if I move an episode to a particular
time, it moves actually, but the movie keeps playing from the beginning and
the timer doesn't count."

## Root cause — resume machinery re-fires on source switch (PROVEN)

**Trigger chain on vix↔goated switch (`switchSource`, vix-player.tsx:725-736):**
1. `setActiveSource(next)` + `setPlaylistUrl(null)` → `mode` flips
   `"native" → "loading" → "native"` (mode = derived from playlistUrl,
   line 317-323).
2. The **resume-lookup effect (line 531-668) has `mode` in its deps** →
   re-runs on every mode flip. It sets `holdForResumeRef = true`,
   `saveEnabledRef = false`, pauses the video (line 591-600), and re-fetches
   `/api/playback` — even though the user is mid-episode.
3. If a bookmark exists (it does — the user has been watching), it
   re-arms `holdForResumeRef = true` + `setResumePosition(pos)` and shows the
   **Resume overlay again** mid-playback (line 639-645).
4. The **hold effect (line 670-685)** re-attaches on `[mode, playlistUrl]` and
   calls `v.pause()` whenever `holdForResumeRef` is true — on `play` AND
   `loadedmetadata`.
5. **The user drags the native seek bar** → browser fires `seeking`/`seeked` →
   our `onSeeked` saves, but the **hold listener re-pauses on the next `play`**
   and the resume overlay is blocking → the video stays at ~0, the time display
   never advances ("timer doesn't count"), and it looks like playback restarts.

**Also broken by the same re-run:** `flushPosition` (line 1174-1208) is blocked
while `holdForResumeRef` is true, so even the seek-to-time is never persisted
correctly after a switch.

## The fix (one guard + one reset)

1. **Run the resume lookup ONCE per episode** — add a ref
   `resumeLookupDoneRef: Record<string, boolean>` (or a single
   `lastLookupKeyRef`) keyed by `playbackParams()`. At the top of the resume
   lookup effect: if the lookup already ran for this key, return early.
   Reset it when the episode actually changes (`playbackParams` identity) —
   NOT on `mode` flips. This stops the source switch from re-arming the hold
   and re-popping the overlay.

2. **Release the hold on manual seek** — in the native `onSeeked` handler
   (line 1220-1223) and/or in a `seeking` listener: if the user manually
   seeks (video.currentTime changes while `holdForResumeRef` is true and the
   overlay is showing), release the hold + close the resume overlay so the
   user's seek wins. The user explicitly said the overlay should not block
   manual scrubbing.

**Alternative if (1) is too invasive:** narrow the resume-lookup deps to drop
`mode` and instead gate on `playlistUrl != null` via a ref — but the
once-per-episode guard is the correct semantic (a bookmark lookup is a
per-episode fact, not a per-mode fact).

## Files
- `components/vix-player.tsx` — resume-lookup effect (531-668), hold effect
  (670-685), `onSeeked` (1220-1223), `switchSource` (725-736).

## Verify
- tsc/lint/build gates.
- Subagent trace: source switch → mode flips → resume lookup must NOT re-run →
  hold not re-armed → manual seek works, timer counts, no overlay re-pop.
- Live test note for user: switch vix→goated mid-episode, seek to a time —
  should seek instantly, timer counts, no "Resume?" overlay.
