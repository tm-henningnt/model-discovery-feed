import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleFeed } from "./fixture";
import { filterModels, modelSearchHaystack } from "./filter";

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

  it("resolves each quality delegation profile", () => {
    const feed = structuredClone(exampleFeed);
    const paidCandidate = structuredClone(feed.models[0]);
    paidCandidate.id = "openrouter:paid-agentic-coder";
    paidCandidate.display_name = "Paid Agentic Coder";
    paidCandidate.provider_model_id = "paid-agentic-coder";
    paidCandidate.canonical_model!.id = "openrouter/paid-agentic-coder";
    paidCandidate.pricing = {
      ...paidCandidate.pricing,
      kind: "paid",
      input_usd_per_1m_tokens: 1,
      output_usd_per_1m_tokens: 1,
      free: null
    };
    paidCandidate.quality = {
      ...paidCandidate.quality,
      coding_score: 60,
      agentic_score: 90,
      speed_score: 100
    };
    feed.models = [feed.models[0], paidCandidate];

    expect(filterModels(feed, { profile: "best-coder" }).map((model) => model.id)).toEqual([
      "openrouter:qwen/qwen3-coder:free"
    ]);
    expect(filterModels(feed, { profile: "best-agentic" }).map((model) => model.id)).toEqual([paidCandidate.id]);
    expect(filterModels(feed, { profile: "fastest-coder" }).map((model) => model.id)).toEqual([
      "openrouter:qwen/qwen3-coder:free"
    ]);
    expect(filterModels(feed, { profile: "best-value-coder" }).map((model) => model.id)).toEqual([paidCandidate.id]);
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

  it("hides a retired offering from a filtered list but keeps it resolvable by direct id lookup", () => {
    const feed = structuredClone(exampleFeed);
    feed.models[0].availability.status = "retired";
    feed.models[0].policy.visibility = "hidden";

    const results = filterModels(feed, {});
    expect(results.find((model) => model.id === feed.models[0].id)).toBeUndefined();

    const byId = feed.models.find((model) => model.id === feed.models[0].id);
    expect(byId).toBeDefined();
    expect(byId?.availability.status).toBe("retired");
  });

  it("builds a search haystack including id, display name, provider name, and provider_model_id", () => {
    const model = exampleFeed.models[0];
    expect(modelSearchHaystack(model)).toBe(
      "openrouter:qwen/qwen3-coder:free qwen3 coder (free) openrouter qwen/qwen3-coder:free"
    );
  });
});
