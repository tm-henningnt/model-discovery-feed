import { afterEach, describe, expect, it, vi } from "vitest";
import { exampleFeed } from "./fixture";
import { OptionalPrismaFeedStore } from "./store";

const originalModelFeedUseDatabase = process.env.MODEL_FEED_USE_DATABASE;
const originalDatabaseUrl = process.env.DATABASE_URL;
const fallbackFeed = structuredClone(exampleFeed);
fallbackFeed.feed.source_revision = "fallback-sentinel";
const fallbackRevision = async () => ({
  generatedAt: fallbackFeed.feed.generated_at,
  sourceRevision: fallbackFeed.feed.source_revision
});

afterEach(() => {
  if (originalModelFeedUseDatabase === undefined) {
    delete process.env.MODEL_FEED_USE_DATABASE;
  } else {
    process.env.MODEL_FEED_USE_DATABASE = originalModelFeedUseDatabase;
  }

  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  vi.restoreAllMocks();
});

describe("OptionalPrismaFeedStore", () => {
  it("returns the fixture fallback when database mode is disabled", async () => {
    const fallback = vi.fn(async () => fallbackFeed);
    const store = new OptionalPrismaFeedStore({
      getFeed: fallback,
      getRevision: fallbackRevision
    });

    await expect(store.getFeed()).resolves.toEqual(fallbackFeed);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("rejects when database mode has no published release", async () => {
    process.env.MODEL_FEED_USE_DATABASE = "true";
    process.env.DATABASE_URL = "postgres://example.test/feed";

    const store = new OptionalPrismaFeedStore(undefined, {
      feedRelease: {
        findFirst: vi.fn(async () => null)
      },
      manualOverride: {
        findMany: vi.fn(async () => [])
      }
    });

    await expect(store.getFeed()).rejects.toThrow("No published feed release found");
  });

  it("returns a valid published release snapshot in database mode", async () => {
    process.env.MODEL_FEED_USE_DATABASE = "true";
    process.env.DATABASE_URL = "postgres://example.test/feed";

    const store = new OptionalPrismaFeedStore(undefined, {
      feedRelease: {
        findFirst: vi.fn(async () => ({ snapshotJson: exampleFeed }))
      },
      manualOverride: {
        findMany: vi.fn(async () => [])
      }
    });

    await expect(store.getFeed()).resolves.toEqual(exampleFeed);
  });

  it("returns the last-known-good database feed after a later failure", async () => {
    process.env.MODEL_FEED_USE_DATABASE = "true";
    process.env.DATABASE_URL = "postgres://example.test/feed";

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fallback = vi.fn(async () => fallbackFeed);
    let overrideCallCount = 0;

    const store = new OptionalPrismaFeedStore({
      getFeed: fallback,
      getRevision: fallbackRevision
    }, {
      feedRelease: {
        findFirst: vi.fn(async () => ({ snapshotJson: exampleFeed }))
      },
      manualOverride: {
        findMany: vi.fn(async () => {
          overrideCallCount += 1;
          if (overrideCallCount === 1) return [];
          throw new Error("database unavailable");
        })
      }
    });

    await expect(store.getFeed()).resolves.toEqual(exampleFeed);
    await expect(store.getFeed()).resolves.toEqual(exampleFeed);
    expect(fallback).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      "Using last-known-good database feed after database read failed."
    );
  });
});

describe("OptionalPrismaFeedStore.getRevision", () => {
  it("returns the fallback revision when database mode is disabled", async () => {
    const store = new OptionalPrismaFeedStore({
      getFeed: async () => fallbackFeed,
      getRevision: fallbackRevision
    });

    await expect(store.getRevision()).resolves.toEqual({
      generatedAt: fallbackFeed.feed.generated_at,
      sourceRevision: "fallback-sentinel"
    });
  });

  // The point of the separate read: a probe every few minutes must not transfer
  // and validate the whole snapshot.
  it("reads the identity columns without the snapshot", async () => {
    process.env.MODEL_FEED_USE_DATABASE = "true";
    process.env.DATABASE_URL = "postgres://example.test/feed";

    const findFirst = vi.fn(async () => ({
      generatedAt: new Date("2026-07-28T08:00:00.000Z"),
      sourceRevision: "collector-run-2026-07-28T08:00:00.000Z"
    }));
    const store = new OptionalPrismaFeedStore(undefined, {
      feedRelease: { findFirst },
      manualOverride: { findMany: vi.fn(async () => []) }
    });

    await expect(store.getRevision()).resolves.toEqual({
      generatedAt: "2026-07-28T08:00:00.000Z",
      sourceRevision: "collector-run-2026-07-28T08:00:00.000Z"
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { status: "published" },
      orderBy: { generatedAt: "desc" },
      select: { generatedAt: true, sourceRevision: true }
    });
  });

  it("rejects when database mode has no published release", async () => {
    process.env.MODEL_FEED_USE_DATABASE = "true";
    process.env.DATABASE_URL = "postgres://example.test/feed";

    const store = new OptionalPrismaFeedStore(undefined, {
      feedRelease: { findFirst: vi.fn(async () => null) },
      manualOverride: { findMany: vi.fn(async () => []) }
    });

    await expect(store.getRevision()).rejects.toThrow("No published feed release found");
  });

  it("rejects instead of guessing when the read fails", async () => {
    process.env.MODEL_FEED_USE_DATABASE = "true";
    process.env.DATABASE_URL = "postgres://example.test/feed";

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new OptionalPrismaFeedStore(undefined, {
      feedRelease: {
        findFirst: vi.fn(async () => {
          throw new Error("database unavailable");
        })
      },
      manualOverride: { findMany: vi.fn(async () => []) }
    });

    await expect(store.getRevision()).rejects.toThrow("Failed to read the published feed revision");
    expect(consoleError).toHaveBeenCalled();
  });
});
