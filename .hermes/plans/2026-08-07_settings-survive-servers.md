# Preserve subtitle/settings across devices, servers & prod pushes

> **Plan mode** — investigation complete. Design decision pending, then implementation via the locked workflow (commit → subagent verify → push).

## The problem (verified)
- All player settings — **subtitle language (`subs`), audio, quality, speed, volume, muted, autoplayNext** — live in **`localStorage`** under `vix-settings` (`lib/vix-settings.ts`, versioned `v:2`).
- `localStorage` is **per-browser, per-device**. It survives app restarts and remounts, but **does NOT survive**: a new device, a cleared browser, incognito, a different browser, or re-login. That's the "doesn't survive servers/prod pushes" pain: switch to your phone or a fresh browser and subtitle defaults reset to `"en"` (or worse, drift to Italian via hls auto-pick — the BANNED_SUB_LANGS guard only protects stored state, not first-run).
- **There is no server-side settings table.** `users` (line 87) has only id/username/passwordHash/createdAt/updatedAt. No `user_settings`, no preferences JSON anywhere.

## The fix (recommended): server-side settings, localStorage as cache

**Add one table** `user_settings` (userId PK/FK → users.id, `settings jsonb` not null default `{}`), then:
- **Write path**: `saveVixSettings()` → (a) still write localStorage (instant, offline, player mount speed), (b) **debounced PATCH** to `POST /api/settings` (server stores JSONB).
- **Read path**: on app load (per-user), fetch settings from server; if server has them, **overwrite localStorage** and apply. localStorage remains the fast path; server is the source of truth across devices.
- **Migration**: drizzle-kit generate (`db:generate`) → apply (`db:migrate` / `db:push`). Versioned schema `v` stays; server merge uses the same `loadVixSettings()` normalization (Italian clamp, defaults merge) so nothing regresses.
- **No device flag needed** — last-write-wins is correct for a single-user app; conflict resolution beyond that is over-engineering here.

## Files
- `lib/schema.ts` — add `user_settings` table
- `drizzle/0001_*.sql` — generated migration
- `app/api/settings/route.ts` — GET (return stored or null) + POST (upsert JSONB)
- `lib/vix-settings.ts` — add server sync: debounced save hook + `hydrateVixSettings()` called once per session (in a client bootstrap / layout effect)
- Optional: `lib/settings-client.ts` — small wrapper to keep `vix-settings.ts` pure (no fetch/effects in a lib file)

## Prod schema note (verified)
- This repo's prod DB is managed with **`db:push`**, not `db:migrate` — `drizzle.__drizzle_migrations` is empty while every table exists. Running `db:migrate` would try to CREATE already-existing tables and fail.
- **`user_settings` was created directly** against prod (Railway @ tokaido.proxy.rlwy.net) with the three safe statements (CREATE TABLE IF NOT EXISTS + FK + index). Migration `0001_wooden_marvel_apes.sql` exists in the repo for reference but its `CREATE watch_history`/`ALTER playback_positions` statements are no-ops on this DB (already exist / already `real`).
- Future schema changes: keep using `db:push` (or hand-applied SQL), not `db:migrate`.

## Verification
- tsc + lint + build green before commit; subagent verify; push.
- Manual: set subs → reload (localStorage path, unchanged); set subs → change device/browser → log in → settings hydrate from server; confirm Italian still never sticks (banned-lang clamp applied on server read too).

## Risks / honest limits
- **JSONB single column** = no per-key DB constraints; validation lives in the route (must mirror `loadVixSettings()` normalization).
- **Race**: two devices writing settings near-simultaneously — last-write-wins loses one side. Acceptable for single-user; document in code.
- **Login-gating**: settings are per-user, so `saveVixSettings()` must no-op the server write when unauthenticated (localStorage still works) — else anon writes could 401-spam or leak.
- **First-run before hydration**: player may briefly use localStorage defaults before server fetch lands — the debounced save + hydrate-on-load closes the window.
- Prod push itself doesn't wipe localStorage; the real gap is cross-device + fresh-browser. This plan closes that.

## Decision needed
1. **Table vs. JSON column on `users`?** Table is cleaner (settings are optional, keep users slim; also lets future per-feature settings scale). JSON column is one line fewer in schema. **Recommend table.**
2. **Scope**: all settings (audio/quality/speed/volume/muted/autoplayNext/subs) or **subs only**? Whole settings bag is the same work as subs-only (one JSONB blob), so **recommend all** — but if you only care about subs now, the plan trims to subs field only in the API.
