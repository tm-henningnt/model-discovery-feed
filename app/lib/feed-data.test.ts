import { beforeEach, describe, expect, it, vi } from "vitest";

const getFeed = vi.fn();

vi.mock("@/feed/store", () => ({
  feedStore: {
    get getFeed() {
      return getFeed;
    }
  }
}));

const { loadFeed } = await import("./feed-data");
const { exampleFeed } = await import("@/feed/fixture");

describe("loadFeed", () => {
  beforeEach(() => {
    getFeed.mockReset();
  });

  it("returns the store's feed when the read succeeds", async () => {
    const feed = structuredClone(exampleFeed);
    feed.feed.source_revision = "collector-run-2026-07-25T00:00:00.000Z";
    getFeed.mockResolvedValue(feed);

    const load = await loadFeed();

    expect(load.ok).toBe(true);
    if (!load.ok) throw new Error("expected ok");
    expect(load.feed.feed.source_revision).toBe("collector-run-2026-07-25T00:00:00.000Z");
    expect(load.usingFixture).toBe(false);
  });

  it("marks a fixture-revision feed as a fixture", async () => {
    getFeed.mockResolvedValue(exampleFeed);

    const load = await loadFeed();

    expect(load.ok).toBe(true);
    if (!load.ok) throw new Error("expected ok");
    expect(load.usingFixture).toBe(true);
  });

  it("falls back to the fixture when the database holds no release yet", async () => {
    getFeed.mockRejectedValue(new Error("No published feed release found"));

    const load = await loadFeed();

    expect(load.ok).toBe(true);
    if (!load.ok) throw new Error("expected ok");
    expect(load.usingFixture).toBe(true);
    expect(load.feed.feed.source_revision).toBe(exampleFeed.feed.source_revision);
  });

  // The point of the change: an outage must not present invented fixture scores
  // as measured ones.
  it("reports failure instead of the fixture when the database read fails", async () => {
    getFeed.mockRejectedValue(new Error("Failed to load published feed release"));

    const load = await loadFeed();

    expect(load.ok).toBe(false);
    expect(load).not.toHaveProperty("feed");
  });

  it("reports failure for an unexpected error", async () => {
    getFeed.mockRejectedValue(new Error("ECONNREFUSED"));

    expect((await loadFeed()).ok).toBe(false);
  });
});
