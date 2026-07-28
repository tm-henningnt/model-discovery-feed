import { beforeEach, describe, expect, it, vi } from "vitest";

const getFeed = vi.fn();
const getRevision = vi.fn();

vi.mock("@/feed/store", () => ({
  feedStore: {
    get getFeed() {
      return getFeed;
    },
    get getRevision() {
      return getRevision;
    }
  }
}));

const { loadFeed, loadFeedRevision } = await import("./feed-data");
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

describe("loadFeedRevision", () => {
  beforeEach(() => {
    getRevision.mockReset();
  });

  it("returns the store's revision when the read succeeds", async () => {
    getRevision.mockResolvedValue({
      generatedAt: "2026-07-28T08:00:00.000Z",
      sourceRevision: "collector-run-2026-07-28T08:00:00.000Z"
    });

    const load = await loadFeedRevision();

    expect(load.ok).toBe(true);
    if (!load.ok) throw new Error("expected ok");
    expect(load.revision.sourceRevision).toBe("collector-run-2026-07-28T08:00:00.000Z");
  });

  // The pages show the fixture in this case, so the probe must report the
  // fixture too. A fault here would leave a notice the reader cannot resolve.
  it("reports the fixture revision when the database holds no release yet", async () => {
    getRevision.mockRejectedValue(new Error("No published feed release found"));

    const load = await loadFeedRevision();

    expect(load.ok).toBe(true);
    if (!load.ok) throw new Error("expected ok");
    expect(load.revision).toEqual({
      generatedAt: exampleFeed.feed.generated_at,
      sourceRevision: exampleFeed.feed.source_revision
    });
  });

  it("reports failure when the read fails", async () => {
    getRevision.mockRejectedValue(new Error("Failed to read the published feed revision"));

    expect((await loadFeedRevision()).ok).toBe(false);
  });
});
