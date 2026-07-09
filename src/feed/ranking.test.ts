import { describe, expect, it } from "vitest";
import { exampleFeed } from "./fixture";
import { hasStaleFreeClaim } from "./classification";
import { selectBestFreeCoder } from "./ranking";

describe("best-free-coder ranking", () => {
  it("selects the fresh free coding model from the fixture", () => {
    expect(selectBestFreeCoder(exampleFeed, new Date("2026-07-08T12:30:00.000Z"))?.id).toBe(
      "openrouter:qwen/qwen3-coder:free"
    );
  });

  it("detects stale free claims", () => {
    expect(hasStaleFreeClaim(exampleFeed.models[0], new Date("2026-07-10T12:30:00.000Z"))).toBe(true);
  });

  it("does not prefer a stale free claim over a fresher eligible alternative", () => {
    const now = new Date("2026-07-08T12:30:00.000Z");
    const staleFree = structuredClone(exampleFeed.models[0]);
    staleFree.id = "openrouter:qwen/qwen3-coder:free-stale";
    staleFree.pricing.free!.last_verified_at = "2026-07-07T23:30:00.000Z";
    staleFree.availability.stale_after_seconds = null;

    const alternative = structuredClone(exampleFeed.models[1]);
    alternative.id = "groq:openai/gpt-oss-120b:alternative";
    alternative.pricing.kind = "subscription_included";
    alternative.pricing.free = null;

    const feed = structuredClone(exampleFeed);
    feed.models = [staleFree, alternative];

    expect(selectBestFreeCoder(feed, now)?.id).toBe(alternative.id);
  });
});
