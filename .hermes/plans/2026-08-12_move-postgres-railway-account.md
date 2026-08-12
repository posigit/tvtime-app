# Move tvtime Postgres to another Railway account — 2026-08-12

## Situation
- tvtime prod Postgres on Railway is **PAUSED for lack of credit** (not sleeping).
- `/api/health` → `{"ok":false,"db":"down"}` — the app is degraded RIGHT NOW.
- DB connection attempts all fail (ECONNRESET / Connection terminated).
- The vix resolver (`vix-production.up.railway.app/health`) ALSO returns 404 "Application not found" — same account freeze. Both services are down.

## Goal
Move the Postgres (and ideally the vix resolver) to a second Railway account that has credit, with **zero data loss and minimal config change**.

## Recommended path: NATIVE PROJECT TRANSFER (preferred)

Railway docs (https://docs.railway.com/projects#transferring-projects):
- Projects can be transferred between workspaces or **to other users**.
- Steps: 1) add target user as a project member, 2) in Members tab, three-dot menu next to that user → **Transfer Ownership**, 3) recipient accepts via email within 24h.
- Transfers move the ENTIRE project as-is: **volumes, environment variables, deployment history, services, and `*.up.railway.app` domains persist**.
- **Requirement: BOTH source and destination must have an active Hobby or Pro plan subscription.**

### Why this is the right play
- Postgres data lives in a Railway *volume* → transfer carries the volume → data intact, no dump/restore.
- `DATABASE_URL` on Vercel (both Production + Preview) keeps working — Railway domains persist across transfer, so no env edit and no app redeploy needed for the DB.
- vix resolver's domain persists too → native playback path survives.

### Steps (user does the dashboard work; I verify)
1. **User checks old account dashboard first (CRITICAL):** is the Postgres service still listed (paused) or deleted? "Application not found" on the resolver could mean paused OR removed. If services are gone → data may be unrecoverable → jump to Recovery section.
2. User adds the SECOND Railway account's email as a member of the tvtime project(s) (can be Member scope).
3. User clicks the three-dot menu next to that member → **Transfer Ownership**.
4. Second account accepts the email (must be <24h).
5. Second account tops up credit / attaches payment → service(s) start.
6. Any transfer block due to "source account not active" (credit-paused may not count as active) → fall back to Path B or top up the old account minimally just to transfer.
7. I verify after transfer: `curl /api/health` → 200 db up; resolver `/health` → 200; row counts match pre-pause baseline if we captured one.

### Risks
- Source account paused-for-credit might not qualify as "active plan" for transfer → Railway may block; test in UI.
- If the new account is also Hobby: Postgres will STILL SLEEP after ~15 min idle → the 21-51s cold-start latency problem does not go away by moving. Must pair with the keepalive fix (below).

## Fallback: pg_dump / pg_restore (only if transfer is impossible)
1. Old account: top up minimal credit (e.g. $5) to unpause the Postgres service.
2. Enable/confirm **Public Access (TCP proxy)** on the Postgres service → `DATABASE_PUBLIC_URL`.
3. `pg_dump "$DATABASE_PUBLIC_URL" --format=custom --no-owner --file=backup.dump` (Windows: need postgres client tools — install via `winget install PostgreSQL` or use the app's own `pg` node dep with a custom dump script; **no psql/pg_dump currently on this box**).
4. New account: create new Postgres service → `pg_restore` the dump.
5. Update `DATABASE_URL` on Vercel Production + Preview (`vercel env rm` + `add`, then `vercel --prod` redeploy) + `.env.local`.
6. Verify `/api/health` + row counts, then delete old service.

## DECISION (2026-08-12, Posi): NO top-up on old account. Transfer blocked (free plan). → FULL REBUILD path.

### What dies / what survives (be honest with Posi)
- DIES: user accounts, library (userShows/userMovies), watchedEpisodes/watchHistory, playback_positions, user_settings, rewatch counts, reactions, community reviews, custom lists.
- SURVIVES: surprise_pool REGENERATES from TMDB via weekly-refresh cron (self-healing); code + configs (env on Vercel, repo) all intact.
- RECOVERY: users re-register; library re-import via the app's /import (URL-based import from TV Time) — the existing importer mirrors favorites/watched.

### Rebuild steps
1. Posi creates Postgres on NEW account → shares DATABASE_URL (new host! env WILL change — not zero-config like transfer).
2. Swap .env.local to new URL → `npm run db:push` (drizzle-kit push — repo is push-managed, `drizzle.__drizzle_migrations` empty; this recreates the FULL schema).
3. Swap Vercel DATABASE_URL (Production + Preview: `vercel env rm` + `add`) → `vercel --prod` redeploy.
4. Verify: `/api/health` → db up, movie page loads <5s, login works.
5. vix resolver (STATELESS — code in posigit/vix): redeploy fresh on new account OR skip → embed sources (VidFast/VidLink/VidZee/VidNest/CineSrc) still play WITHOUT resolver; only native hls.js controls + resume need it.
6. Keepalive: GH Actions db-keepalive.yml pins /api/health → with sleeping DB the wake latency returns; pair with withDbRetry fix (movies/page.tsx:283) on Posi's go.

### Economics warning (brief, do not re-litigate)
New Hobby account also has $5/mo credit. 24/7 Postgres + resolver WILL burn it the same way. Cheapest lean config: Postgres only, sleeping (bills compute only when awake ≈ pennies), EMBED sources for playback, resolver only if native controls are worth it.

## Recovery (if services were DELETED, not just paused)
- Railway volume backups / PITR: check the old project's **Backups tab** on the Postgres service. Volume backups restore to same project only — if the project still exists, restore then transfer. PITR fork restores to a sibling service in the same project.
- If nothing exists → data loss; rebuild schema via `npm run db:push` (drizzle-kit push, this repo is push-managed, `drizzle.__drizzle_migrations` is empty) against a fresh Postgres on account 2. Users/watch-history/surprise-pool/settings would be lost.

## MUST pair with (existing pending fixes — same session)
1. **Cold-start latency fix** (still not shipped): wrap `movies/page.tsx:283` bare `db.select()` in `withDbRetry` (like `shows/page.tsx:63`); optionally raise `connectionTimeoutMillis` 20s→45s in `lib/db.ts`.
2. **Keepalive**: GH Actions scheduler is unreliable (observed 62-66 min gaps). Best: external 5-min pinger (cron-job.org) hitting `https://tvtime-app-beta.vercel.app/api/health` — zero code; OR tighten if the new account is Pro (no sleep anyway).
3. After move: update `.env.local` if the DB URL changed (transfer path: it won't).

## Verification checklist (post-move)
- [ ] `curl https://tvtime-app-beta.vercel.app/api/health` → `{"ok":true,"db":"up"}`
- [ ] `curl https://vix-production.up.railway.app/health` → 200 (if resolver moved too)
- [ ] Row counts for users, surprise_pool, playback_positions match expected
- [ ] App loads a movie page in <5s (not 21-51s)
- [ ] Vercel `DATABASE_URL` unchanged (transfer path) or updated (dump path) + redeployed