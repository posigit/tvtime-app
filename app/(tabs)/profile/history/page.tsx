import { requireAuth } from "@/lib/auth";
import { getWatchHistory } from "@/lib/playback";
import Link from "next/link";
import { ChevronLeft, History } from "lucide-react";
import { StickyChrome } from "@/components/sticky-chrome";
import { RecentStreamsList } from "@/components/recent-streams";

export default async function WatchHistoryPage() {
  const userId = await requireAuth();
  const items = await getWatchHistory(userId, 100).catch(() => []);

  return (
    <div className="min-h-dvh bg-black pb-nav-page">
      <StickyChrome contentClassName="px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <Link
            href="/profile"
            aria-label="Back to profile"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white active:scale-95"
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-xl font-bold text-white">Watch history</h1>
        </div>
      </StickyChrome>

      <div className="px-4 pt-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-24 text-center">
            <History className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 font-bold text-white">No watch history yet</p>
            <p className="mb-6 max-w-[240px] text-sm text-muted-foreground">
              Anything you stream or finish will show up here so you can jump
              straight back in.
            </p>
            <Link
              href="/profile"
              className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-black"
            >
              Back to profile
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              {items.length} item{items.length === 1 ? "" : "s"} · last 100
            </p>

            <RecentStreamsList items={items} />
          </>
        )}
      </div>
    </div>
  );
}
