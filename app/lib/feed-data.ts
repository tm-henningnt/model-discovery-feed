import { feedStore } from "@/feed/store";
import { exampleFeed } from "@/feed/fixture";
import { isFixtureSourceRevision } from "@/feed/classification";
import { buildStatus } from "@/server/status";
import type { FeedDocument } from "@/feed/schema";

export type FeedStatus = ReturnType<typeof buildStatus>;

export type FeedLoad =
  | { ok: true; feed: FeedDocument; status: FeedStatus; usingFixture: boolean }
  | { ok: false };

/**
 * Read the current feed for server components.
 *
 * There are three outcomes, and the difference matters. A store with no
 * database configured, or a database with no release yet, falls back to the
 * bundled fixture. The site then has something to show, and the caller marks it
 * as an example.
 *
 * A failed database read returns `ok: false` instead. The fixture holds example
 * offerings with invented scores, so a fallback during an outage would present
 * invented numbers as measured ones.
 */
export async function loadFeed(): Promise<FeedLoad> {
  try {
    const feed = await feedStore.getFeed();
    return {
      ok: true,
      feed,
      status: buildStatus(feed),
      usingFixture: isFixtureSourceRevision(feed.feed.source_revision)
    };
  } catch (error) {
    if (error instanceof Error && error.message === "No published feed release found") {
      return { ok: true, feed: exampleFeed, status: buildStatus(exampleFeed), usingFixture: true };
    }

    return { ok: false };
  }
}
