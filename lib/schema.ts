import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const shows = pgTable("shows", {
  tmdbId: integer("tmdb_id").primaryKey(),
  type: text("type").notNull().default("tv"),
  title: text("title").notNull(),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  firstAirDate: text("first_air_date"),
  lastAirDate: text("last_air_date"),
  status: text("status"),
  overview: text("overview"),
  networks: text("networks").array(),
  numberOfSeasons: integer("number_of_seasons"),
  numberOfEpisodes: integer("number_of_episodes"),
  episodeRuntime: integer("episode_runtime"),
  voteAverage: real("vote_average"),
  rtScore: integer("rt_score"),
  /** RT Popcornmeter (audience score 0–100); -1 = checked, none. */
  rtAudienceScore: integer("rt_audience_score"),
  /** Metacritic Metascore (0–100) via OMDb; -1 = checked, none. */
  mcScore: integer("mc_score"),
  /** Last successful RT/OMDb check — used to re-fetch Tomatometer every ~2 weeks. */
  rtCheckedAt: timestamp("rt_checked_at"),
  imdbId: text("imdb_id"),
  tmdbData: jsonb("tmdb_data"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const movies = pgTable("movies", {
  tmdbId: integer("tmdb_id").primaryKey(),
  type: text("type").notNull().default("movie"),
  title: text("title").notNull(),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  releaseDate: text("release_date"),
  runtime: integer("runtime"),
  status: text("status"),
  overview: text("overview"),
  voteAverage: real("vote_average"),
  rtScore: integer("rt_score"),
  /** RT Popcornmeter (audience score 0–100); -1 = checked, none. */
  rtAudienceScore: integer("rt_audience_score"),
  /** Metacritic Metascore (0–100) via OMDb; -1 = checked, none. */
  mcScore: integer("mc_score"),
  /** Last successful RT/OMDb check — used to re-fetch Tomatometer every ~2 weeks. */
  rtCheckedAt: timestamp("rt_checked_at"),
  imdbId: text("imdb_id"),
  tmdbData: jsonb("tmdb_data"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const episodes = pgTable(
  "episodes",
  {
    showTmdbId: integer("show_tmdb_id")
      .notNull()
      .references(() => shows.tmdbId, { onDelete: "cascade" }),
    seasonNumber: integer("season_number").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    title: text("title").notNull().default(""),
    overview: text("overview"),
    airDate: text("air_date"),
    stillPath: text("still_path"),
    runtime: integer("runtime"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.showTmdbId, table.seasonNumber, table.episodeNumber],
    }),
  ]
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    publicHandle: text("public_handle").unique(),
    publicProfile: boolean("public_profile").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("username_idx").on(table.username)]
);

export const userShows = pgTable(
  "user_shows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id")
      .notNull()
      .references(() => shows.tmdbId, { onDelete: "cascade" }),
    status: text("status").notNull().default("watching"),
    favorite: boolean("favorite").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    episodesWatched: integer("episodes_watched").notNull().default(0),
    lastSeason: integer("last_season"),
    lastEpisode: integer("last_episode"),
    lastWatchedAt: timestamp("last_watched_at"),
    followedAt: timestamp("followed_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.tmdbId] })]
);

export const userMovies = pgTable(
  "user_movies",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id")
      .notNull()
      .references(() => movies.tmdbId, { onDelete: "cascade" }),
    status: text("status").notNull().default("want_to_watch"),
    favorite: boolean("favorite").notNull().default(false),
    watchedAt: timestamp("watched_at"),
    rating: integer("rating"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.tmdbId] })]
);

export const watchedEpisodes = pgTable(
  "watched_episodes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    showTmdbId: integer("show_tmdb_id")
      .notNull()
      .references(() => shows.tmdbId, { onDelete: "cascade" }),
    seasonNumber: integer("season_number").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    watchedAt: timestamp("watched_at"),
    rating: integer("rating"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.showTmdbId, table.seasonNumber, table.episodeNumber],
    }),
  ]
);

export const seasonRewatches = pgTable(
  "season_rewatches",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    showTmdbId: integer("show_tmdb_id")
      .notNull()
      .references(() => shows.tmdbId, { onDelete: "cascade" }),
    seasonNumber: integer("season_number").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.showTmdbId, table.seasonNumber],
    }),
  ]
);

export const episodeReactions = pgTable(
  "episode_reactions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    showTmdbId: integer("show_tmdb_id")
      .notNull()
      .references(() => shows.tmdbId, { onDelete: "cascade" }),
    seasonNumber: integer("season_number").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    reactionKey: text("reaction_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.userId,
        table.showTmdbId,
        table.seasonNumber,
        table.episodeNumber,
        table.reactionKey,
      ],
    }),
  ]
);

export const movieReactions = pgTable(
  "movie_reactions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id")
      .notNull()
      .references(() => movies.tmdbId, { onDelete: "cascade" }),
    reactionKey: text("reaction_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.tmdbId, table.reactionKey] })]
);

export const userLists = pgTable("user_lists", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'favorite_shows' | 'favorite_movies' | 'custom'
  items: jsonb("items").notNull().default("[]"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Surprise Me pool — rebuilt every 2 days by /api/cron/weekly.
 * Pages read this table instead of hammering TMDB discover on every load.
 */
export const surprisePool = pgTable("surprise_pool", {
  tmdbId: integer("tmdb_id").primaryKey(),
  title: text("title").notNull(),
  posterPath: text("poster_path"),
  releaseDate: text("release_date"),
  runtime: integer("runtime"),
  voteAverage: real("vote_average"),
  /** "Top rated" | "Critically acclaimed" | "Classic" | "Hidden gem" | decade… */
  badge: text("badge"),
  /** Period the pool was built for, e.g. "2026-P183". */
  week: text("week").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Web-push subscriptions for new-episode alerts. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);

/**
 * Resume-playback positions. One row per user per media item.
 * Movies use season_number=0 / episode_number=0.
 */
export const playbackPositions = pgTable(
  "playback_positions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaType: text("media_type").notNull(), // "movie" | "tv"
    tmdbId: integer("tmdb_id").notNull(),
    seasonNumber: integer("season_number").notNull().default(0),
    episodeNumber: integer("episode_number").notNull().default(0),
    positionSeconds: real("position_seconds").notNull().default(0),
    durationSeconds: real("duration_seconds").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.userId, t.mediaType, t.tmdbId, t.seasonNumber, t.episodeNumber],
    }),
    index("playback_positions_user_updated_idx").on(t.userId, t.updatedAt),
  ]
);

/** Append-only completion history. Unlike watched state, rewatches remain visible. */
export const watchHistory = pgTable(
  "watch_history",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaType: text("media_type").notNull(), // "movie" | "tv"
    tmdbId: integer("tmdb_id").notNull(),
    seasonNumber: integer("season_number").notNull().default(0),
    episodeNumber: integer("episode_number").notNull().default(0),
    watchedAt: timestamp("watched_at").defaultNow().notNull(),
    source: text("source").notNull().default("player"), // "player" | "manual"
  },
  (t) => [
    index("watch_history_user_watched_idx").on(t.userId, t.watchedAt),
    index("watch_history_media_idx").on(t.mediaType, t.tmdbId),
  ]
);

/**
 * Server-side copy of player settings (vix-settings). localStorage remains
 * the fast path; this table is the source of truth across devices/browsers.
 * Single JSONB blob — validation/normalization lives in the API route and
 * mirrors lib/vix-settings.ts (defaults merge + banned-language clamp).
 */
export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    settings: jsonb("settings").notNull().default({}),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("user_settings_updated_idx").on(t.updatedAt)]
);

/**
 * Shared TMDB catalog lists (trending, popular, top 10, genres).
 * Explore reads this instead of hitting TMDB on every page load.
 */
export const tmdbListCache = pgTable("tmdb_list_cache", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

/**
 * Personal Explore digest — rebuilt at most once per app-local day.
 */
export const userExploreDigest = pgTable(
  "user_explore_digest",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    dailyPick: jsonb("daily_pick"),
    forYou: jsonb("for_you").notNull().default([]),
    because: jsonb("because").notNull().default([]),
    builtAt: timestamp("built_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })]
);
