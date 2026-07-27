import { describe, expect, it } from "vitest";
import { exampleFeed } from "@/feed/fixture";
import { buildStatus } from "./status";

describe("buildStatus", () => {
  it("marks a feed stale after expires_at", () => {
    const feed = structuredClone(exampleFeed);

    expect(buildStatus(feed, new Date("2026-07-08T17:00:01.000Z"))).toMatchObject({
      stale: true,
      collector_health: {
        status: "degraded",
        notices: []
      }
    });
  });

  it("uses generated_at plus default stale seconds when expires_at is null", () => {
    const feed = structuredClone(exampleFeed);
    feed.feed.expires_at = null;

    expect(buildStatus(feed, new Date("2026-07-08T17:00:01.000Z"))).toMatchObject({
      stale: true,
      stale_at: "2026-07-08T17:00:00.000Z"
    });
  });

  it("reports unknown collector health for a fresh fixture feed without notices", () => {
    const feed = structuredClone(exampleFeed);

    expect(buildStatus(feed, new Date("2026-07-08T12:30:00.000Z"))).toMatchObject({
      stale: false,
      collector_health: {
        status: "unknown",
        message: "Serving a static or fixture feed without collector run metadata.",
        notices: []
      }
    });
  });

  it("reports ok collector health for a fresh collector-run feed without notices", () => {
    const feed = structuredClone(exampleFeed);
    feed.feed.source_revision = "collector-run-2026-07-08T12:00:00.000Z";

    expect(buildStatus(feed, new Date("2026-07-08T12:30:00.000Z"))).toMatchObject({
      stale: false,
      collector_health: {
        status: "ok",
        message: "Latest collector run produced a fresh feed without notices.",
        notices: []
      }
    });
  });

  it("reports degraded collector health when notices are present", () => {
    const feed = structuredClone(exampleFeed);
    feed.feed.source_revision = "collector-run-2026-07-08T12:00:00.000Z";
    feed.notices = [{ collector: "groq", message: "collector unavailable", status: 503 }];

    expect(buildStatus(feed, new Date("2026-07-08T12:30:00.000Z"))).toMatchObject({
      stale: false,
      collector_health: {
        status: "degraded",
        message: "Collector notices are present.",
        notices: [{ collector: "groq", message: "collector unavailable", status: 503 }]
      }
    });
  });
});
