import type { FeedDocument } from "@/feed/schema";

function isCollectorMaterializedFeed(feed: FeedDocument): boolean {
  return feed.feed.source_revision.startsWith("collector-run-");
}

function buildCollectorHealth(feed: FeedDocument, stale: boolean) {
  if (stale) {
    return {
      status: "degraded" as const,
      message: "Feed is stale.",
      notices: feed.notices
    };
  }

  if (feed.notices.length > 0) {
    return {
      status: "degraded" as const,
      message: "Collector notices are present.",
      notices: feed.notices
    };
  }

  if (isCollectorMaterializedFeed(feed)) {
    return {
      status: "ok" as const,
      message: "Latest collector run produced a fresh feed without notices.",
      notices: feed.notices
    };
  }

  return {
    status: "unknown" as const,
    message: "Serving a static or fixture feed without collector run metadata.",
    notices: feed.notices
  };
}

export function buildStatus(feed: FeedDocument, now = new Date()) {
  const expiresAt = feed.feed.expires_at ? new Date(feed.feed.expires_at) : null;
  const generatedAt = new Date(feed.feed.generated_at);
  const staleAt = expiresAt ?? new Date(generatedAt.getTime() + feed.feed.default_stale_after_seconds * 1000);
  const stale = staleAt.getTime() <= now.getTime();

  return {
    object: "feed_status",
    feed_id: feed.feed.id,
    schema_version: feed.schema_version,
    generated_at: generatedAt.toISOString(),
    expires_at: expiresAt?.toISOString() ?? null,
    stale_at: staleAt.toISOString(),
    source_revision: feed.feed.source_revision,
    stale,
    provider_count: feed.providers.length,
    model_count: feed.models.length,
    profile_count: feed.profiles.length,
    collector_health: buildCollectorHealth(feed, stale)
  };
}
