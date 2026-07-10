import { feedStore } from "@/feed/store";
import { exampleFeed } from "@/feed/fixture";
import { isFixtureSourceRevision } from "@/feed/classification";
import { buildStatus } from "@/server/status";
import type { FeedDocument } from "@/feed/schema";

export type FeedStatus = ReturnType<typeof buildStatus>;

/**
 * Read the current feed for server components. Falls back to the bundled
 * fixture if a database-backed store is configured but has no release yet,
 * so the site always renders something real to explore.
 */
export async function loadFeed(): Promise<{ feed: FeedDocument; status: FeedStatus; usingFixture: boolean }> {
  try {
    const feed = await feedStore.getFeed();
    return { feed, status: buildStatus(feed), usingFixture: isFixtureSourceRevision(feed.feed.source_revision) };
  } catch {
    return { feed: exampleFeed, status: buildStatus(exampleFeed), usingFixture: isFixtureSourceRevision(exampleFeed.feed.source_revision) };
  }
}
