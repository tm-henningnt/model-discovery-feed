import { afterEach, describe, expect, it, vi } from "vitest";
import { exampleFeed } from "./fixture";
import { OptionalPrismaFeedStore } from "./store";

const originalModelFeedUseDatabase = process.env.MODEL_FEED_USE_DATABASE;
const originalDatabaseUrl = process.env.DATABASE_URL;
const fallbackFeed = structuredClone(exampleFeed);
fallbackFeed.feed.source_revision = "fallback-sentinel";

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
      getFeed: fallback
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
      getFeed: fallback
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
