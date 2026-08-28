import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth";
import {
  EXPLORE_TAB_COOKIE,
  resolveExploreTab,
  type ExploreTab,
} from "@/lib/explore-tab";
import { loadExploreDiscover, loadExploreFeed } from "@/lib/explore-data";
import { SearchBar } from "@/components/search-bar";
import { StickyChrome } from "@/components/sticky-chrome";
import { ExplorePills } from "@/components/explore-pills";
import { ShowFollowButton } from "@/components/show-follow-button";
import { DiscoverRail } from "@/components/discover-rail";
import { DiscoverGenreBrowser } from "@/components/discover-genre-browser";
import { DailyPickCard } from "@/components/daily-pick";
import { TopTenRail } from "@/components/top-ten";
import { TonightStrip } from "@/components/tonight-strip";
import { ContinueWatchingRail } from "@/components/continue-watching";
import { SectionLabel } from "@/components/section-label";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import Image from "next/image";

function PosterTile({
  title,
  posterPath,
  href,
  action,
}: {
  title: string;
  posterPath?: string | null;
  href: string;
  action: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-card">
      <Link href={href}>
        <div style={{ aspectRatio: "2 / 3" }} className="relative bg-secondary">
          {posterPath ? (
            <Image
              src={posterUrl(posterPath, "w342") ?? ""}
              alt={title}
              fill
              sizes="(max-width: 768px) 33vw, 200px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
              {title}
            </div>
          )}
        </div>
      </Link>
      <div className="absolute right-1.5 top-1.5">{action}</div>
    </div>
  );
}

function GridSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3">
        <SectionLabel>{label}</SectionLabel>
      </div>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </section>
  );
}

async function FeedBody({ userId }: { userId: string }) {
  const data = await loadExploreFeed(userId);
  const { digest, library, continueWatching, tonight, topShows, topMovies } =
    data;
  const pick = digest.dailyPick;

  return (
    <>
      <TonightStrip items={tonight} />
      <ContinueWatchingRail items={continueWatching} />

      <TopTenRail
        label="Top 10 Series"
        kicker="Hottest this week"
        href="/explore/top-10/shows"
        items={topShows}
        ownedIds={library.followedShowIds}
        priority
        featured
      />

      {pick && (
        <DailyPickCard
          pick={pick}
          following={
            pick.item.mediaType === "tv"
              ? library.followedShowIds.has(pick.item.id)
              : false
          }
          movieStatus={
            pick.item.mediaType === "movie"
              ? library.movieStatusById.get(pick.item.id) || null
              : null
          }
        />
      )}

      {digest.forYou.length > 0 && (
        <DiscoverRail
          label="For you"
          items={digest.forYou}
          followedShowIds={library.followedShowIds}
          movieStatusById={library.movieStatusById}
        />
      )}

      {digest.because.slice(0, 2).map((rail) => (
        <DiscoverRail
          key={rail.seedTitle}
          label={`Because you watched ${rail.seedTitle}`}
          items={rail.items}
          followedShowIds={library.followedShowIds}
          movieStatusById={library.movieStatusById}
        />
      ))}

      <TopTenRail
        label="Top 10 Movies"
        href="/explore/top-10/movies"
        items={topMovies}
        ownedIds={library.ownedMovieIds}
      />
    </>
  );
}

async function DiscoverBody({ userId }: { userId: string }) {
  const data = await loadExploreDiscover(userId);
  const { library } = data;
  const movieStatusRecord = Object.fromEntries(library.movieStatusById);

  return (
    <>
      <p className="mb-4 text-center text-xs text-muted-foreground">
        Find something new — not already in your library
      </p>

      <DiscoverRail
        label="Hidden gems"
        items={data.hiddenGems}
        followedShowIds={library.followedShowIds}
        movieStatusById={library.movieStatusById}
      />
      <DiscoverRail
        label="Hot movies this week"
        items={data.hotMovies}
        followedShowIds={library.followedShowIds}
        movieStatusById={library.movieStatusById}
      />
      <DiscoverRail
        label="Popular series"
        items={data.popularTv}
        followedShowIds={library.followedShowIds}
        movieStatusById={library.movieStatusById}
      />
      <DiscoverRail
        label="Coming to theaters"
        items={data.upcoming}
        followedShowIds={library.followedShowIds}
        movieStatusById={library.movieStatusById}
      />

      <DiscoverGenreBrowser
        genres={data.genreChips}
        followedShowIds={[...library.followedShowIds]}
        movieStatusById={movieStatusRecord}
      />

      {data.airingToday.length > 0 && (
        <GridSection label="Airing Today">
          {data.airingToday.map((show) => (
            <PosterTile
              key={show.id}
              title={show.title}
              posterPath={show.poster_path}
              href={`/show/${show.id}`}
              action={
                <ShowFollowButton
                  tmdbId={show.id}
                  initialFollowing={false}
                  variant="overlay"
                />
              }
            />
          ))}
        </GridSection>
      )}

      <DiscoverRail
        label="In theaters now"
        items={data.nowPlaying}
        followedShowIds={library.followedShowIds}
        movieStatusById={library.movieStatusById}
      />

      {data.onTheAir.length > 0 && (
        <GridSection label="On The Air">
          {data.onTheAir.map((show) => (
            <PosterTile
              key={show.id}
              title={show.title}
              posterPath={show.poster_path}
              href={`/show/${show.id}`}
              action={
                <ShowFollowButton
                  tmdbId={show.id}
                  initialFollowing={false}
                  variant="overlay"
                />
              }
            />
          ))}
        </GridSection>
      )}

      <DiscoverRail
        label="Critically loved films"
        items={data.topMovies}
        followedShowIds={library.followedShowIds}
        movieStatusById={library.movieStatusById}
      />
    </>
  );
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const userId = await requireAuth();
  const { tab: tabParam } = await searchParams;
  const cookieStore = await cookies();
  const tab: ExploreTab = resolveExploreTab(
    tabParam,
    cookieStore.get(EXPLORE_TAB_COOKIE)?.value
  );

  return (
    <div className="min-h-dvh bg-black pb-nav-page">
      <StickyChrome contentClassName="px-4 pt-3 pb-1">
        <SearchBar />
      </StickyChrome>
      <div className="px-4 pt-1">
        <ExplorePills active={tab} />
        <div className="pt-3">
          {tab === "discover" ? (
            <DiscoverBody userId={userId} />
          ) : (
            <FeedBody userId={userId} />
          )}
        </div>
      </div>
    </div>
  );
}
