import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
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
