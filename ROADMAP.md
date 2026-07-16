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
- [ ] Explore page (search + trending + airing today)
- [ ] Profile page (stats + lists)
- [ ] Episode watch/unwatch API routes

---

## v1.1

| Feature | Why |
|---------|-----|
| **Calendar page** | "What's airing today/this week" — filtered to your followed shows. TMDB `/tv/airing_today` cross-referenced with `user_shows`. TV Time's most-used feature. |
| **GDPR import** | Upload `followed_tv_show.csv` + `show_seen_episode_latest.csv`. Show name → TMDB search → populate `shows` + `user_shows` + `watched_episodes`. |
| **Stats dashboard** | Total episodes watched, total hours (sum episode runtime), current streaks, top shows by time spent. All computable from `watched_episodes` + `shows.episodeRuntime`. |
| **Season progress bars** | On show cards: "S3 E8 · 62%". TV Time's signature visual. Query: count watched episodes in latest season / total episodes in that season. |

---

## v1.2 — Discovery

| Feature | Why |
|---------|-----|
| **Search on Explore** | Debounced search across shows + movies. Already have `searchTv()` + `searchMovie()` in TMDB client. Just needs UI. |
| **Trending carousel** | Homepage hero with TMDB trending week. Poster carousel + "Follow" button on each. |
| **Popular / Top Rated** | Browse tabs on Explore. TMDB `/tv/popular`, `/tv/top_rated`, `/movie/popular`. |
| **Watch providers filter** | "Where can I watch this in Nigeria?" TMDB `/tv/{id}/watch/providers` with `watch_region=NG`. Show Netflix/Prime/Apple logos. |

---

## v1.3 — Power Features

| Feature | Why |
|---------|-----|
| **Trakt sync** | Two-way sync: mark watched on Trakt → appears here, mark here → appears on Trakt. Big for ecosystem compatibility. |
| **Push notifications** | "New episode of Silo airs tomorrow". Cron job: query `tv/airing_today`, match `user_shows`, send web push via service worker. |
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
