# TV Time Replacement — Roadmap

## MVP (Building now)
Architecture done. Pages being wired.

- [x] TMDB client (search, shows, seasons, trending, airing)
- [x] DB schema (shows, movies, users, watched, reactions, lists)
- [x] Auth (credentials + JWT)
- [x] Bottom tab nav (Shows / Movies / Explore / Profile)
- [x] Login screen
- [x] PWA (installable on phone)
- [ ] Shows page (poster grid from user_shows)
- [ ] Show detail page (seasons → episodes → mark watched)
- [ ] Movies page (movie grid)
- [x] Explore page (search + recs + Top 10 + Discover)
- [ ] Profile page (stats + lists)
- [ ] Episode watch/unwatch API routes

---

## v1.1

| Feature | Why |
|---------|-----|
| **Calendar page** ✅ | `/calendar` — followed shows' episodes by air date (7-day lookback + all future), premiere/latest badges, mark-watched inline. |
| ~~**GDPR import**~~ | Done. |
| **Stats dashboard** | Total episodes watched, total hours (sum episode runtime), current streaks, top shows by time spent. All computable from `watched_episodes` + `shows.episodeRuntime`. |
| **Season progress bars** | On show cards: "S3 E8 · 62%". TV Time's signature visual. Query: count watched episodes in latest season / total episodes in that season. |

---

## v1.2 — Discovery

| Feature | Why |
|---------|-----|
| **Search on Explore** ✅ | Debounced search across shows + movies. |
| **Trending carousel / Top 10** ✅ | Ranked Top 10 shows + movies on Feed; Daily Pick hero. |
| **Popular / Top Rated** ✅ | Discover rails + genre browser. |
| **Watch providers filter** | "Where can I watch this in Nigeria?" TMDB `/tv/{id}/watch/providers` with `watch_region=NG`. Show Netflix/Prime/Apple logos. |

---

## v1.3 — Power Features

| Feature | Why |
|---------|-----|
| **Trakt sync** | Two-way sync: mark watched on Trakt → appears here, mark here → appears on Trakt. Big for ecosystem compatibility. |
| ~~**Push notifications**~~ ✅ | Done: daily digest push for episodes airing today (`/api/cron/episode-alerts`, profile toggle). |
| **Rewatch tracking** | Mark a show as "rewatching" → fresh progress counter. Your schema has the data model for it (just needs `rewatch_count` column or separate sessions). |
| **Custom lists** | "Best of 2026", "Cosy rewatches", "Shows to binge". Schema has `user_lists` table ready. Needs CRUD API + UI. |
| **Episode reactions** | TV Time's heart/Wow/OK reactions. Schema has `episode_reactions` table. Needs emoji picker UI. |

---

## v2.0 — Social

| Feature | Why |
|---------|-----|
| **Friend feed** | See what friends are watching. TV Time's USP was the social layer. |
| **Shared lists** | Collaborative lists. "Our watchlist" with a partner/friend group. |
| **Activity feed** | "X watched S2E5 of Breaking Bad" — chronological feed of your activity. |
| **Comments/discussions** | Per-episode threads. Heavy moderation burden, but massive engagement driver. |

---

## Nice-to-Have (Whenever)

- **Dark/AMOLED theme toggle** — pure black background for OLED screens, saves battery
- **Year in Review** — "You watched 342 episodes across 28 shows in 2026"
- **Season pass** — toggle to auto-mark entire upcoming season as "plan to watch"
- **Speed controls** — "I watch at 1.5x" — adjust runtime stats
- **Export your data** — GDPR-style export. You already know the format.
- **Multiple profiles** — household sharing on one install
- **Anime tracker** — separate tab or mode with Simkl API integration

---

## Tech Debt (Before Going Public)

- Rate limiting on TMDB calls (currently ISR-cached at 24h, fine for single user, needs queue for multi-user)
- Image caching/proxy — don't hotlink TMDB images forever
- Database backups
- Proper error boundaries on pages
- Loading skeletons for every data-fetching page
