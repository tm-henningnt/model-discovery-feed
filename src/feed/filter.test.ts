import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleFeed } from "./fixture";
import { filterModels } from "./filter";

describe("filterModels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters additively by provider, capability, pricing, protocol, and context", () => {
    const results = filterModels(exampleFeed, {
      provider: "openrouter",
      capabilities: ["coding", "tool_use"],
      pricingKind: "free",
      protocol: "openai_chat_completions",
      minContextTokens: 200000,
      available: true
    });

    expect(results.map((model) => model.id)).toEqual(["openrouter:qwen/qwen3-coder:free"]);
  });

  it("filters by profile selection", () => {
    expect(filterModels(exampleFeed, { profile: "best-free-coder" }).map((model) => model.id)).toEqual([
      "openrouter:qwen/qwen3-coder:free"
    ]);
  });

  it("returns no results for an unknown profile", () => {
    expect(filterModels(exampleFeed, { profile: "missing" })).toEqual([]);
  });

  it("uses provider auth fallback for api-key filtering", () => {
    expect(filterModels(exampleFeed, { requiresApiKey: true }).map((model) => model.id)).toEqual([
      "openrouter:qwen/qwen3-coder:free",
      "groq:openai/gpt-oss-120b"
    ]);
  });

  it("does not treat unknown credit-card requirements as false", () => {
    expect(filterModels(exampleFeed, { requiresCreditCard: false })).toEqual([]);
  });

  it("excludes stale free claims from free=true", () => {
    const feed = structuredClone(exampleFeed);
    feed.models[0].pricing.free!.last_verified_at = "2026-07-06T12:00:00.000Z";

    expect(filterModels(feed, { free: true })).toEqual([]);
  });

  it("keeps stale free claims and unknown pricing when free=false", () => {
    const feed = structuredClone(exampleFeed);
    feed.models[0].pricing.free!.last_verified_at = "2026-07-06T12:00:00.000Z";

    expect(filterModels(feed, { free: false }).map((model) => model.id)).toEqual([
      "openrouter:qwen/qwen3-coder:free",
      "groq:openai/gpt-oss-120b"
    ]);
  });
});
