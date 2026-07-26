import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleFeed } from "./fixture";
import type { FeedDocument, ModelOffering } from "./schema";
import { filterModels, filtersFromSearchParams, modelPlanEditions, modelSearchHaystack } from "./filter";

/**
 * A feed with one plan sold in two editions: a shared model, a Team-only model, and a
 * pay-as-you-go model that no edition covers.
 */
function planFeed(): FeedDocument {
  const feed = structuredClone(exampleFeed);
  const make = (id: string, editions: string[] | null, tags: string[]): ModelOffering => {
    const model = structuredClone(feed.models[0]);
    model.id = id;
    model.provider = { id: "token-plan", name: "Token Plan" };
    model.pricing = {
      ...model.pricing,
      kind: editions ? "subscription_included" : "paid",
      free: null,
      ...(editions ? { subscription: { billing: "flat_monthly", plan_editions: editions } } : {})
    };
    model.policy = { ...model.policy, tags };
    return model;
  };

  feed.models = [
    make("plan:both", ["personal", "team"], ["token-plan", "token-plan-personal", "token-plan-team"]),
    make("plan:team-only", ["team"], ["token-plan", "token-plan-team"]),
    make("plan:payg", null, ["image-generation"])
  ];
  return feed;
}

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

  it("keeps only the offerings one plan edition covers", () => {
    expect(filterModels(planFeed(), { planEditions: ["personal"] }).map((model) => model.id)).toEqual([
      "plan:both"
    ]);
  });

  it("unions the rosters of several plan editions", () => {
    expect(filterModels(planFeed(), { planEditions: ["personal", "team"] }).map((model) => model.id)).toEqual([
      "plan:both",
      "plan:team-only"
    ]);
  });

  it("excludes an offering with no subscription from every plan-edition filter", () => {
    expect(filterModels(planFeed(), { planEditions: ["team"] }).map((model) => model.id)).not.toContain("plan:payg");
  });

  it("matches an offering that carries any one of the requested tags", () => {
    expect(filterModels(planFeed(), { tags: ["token-plan-personal"] }).map((model) => model.id)).toEqual([
      "plan:both"
    ]);
    expect(filterModels(planFeed(), { tags: ["image-generation", "token-plan-team"] }).map((model) => model.id)).toEqual([
      "plan:both",
      "plan:team-only",
      "plan:payg"
    ]);
  });

  it("reads tag and plan_edition as comma-separated lists", () => {
    const filters = filtersFromSearchParams(new URLSearchParams("tag=token-plan,image-generation&plan_edition=personal"));
    expect(filters.tags).toEqual(["token-plan", "image-generation"]);
    expect(filters.planEditions).toEqual(["personal"]);
  });

  it("reports no plan editions for an offering without a subscription", () => {
    expect(modelPlanEditions(exampleFeed.models[0])).toEqual([]);
  });

  it("builds a search haystack including id, display name, provider name, and provider_model_id", () => {
    const model = exampleFeed.models[0];
    expect(modelSearchHaystack(model)).toBe(
      "openrouter:qwen/qwen3-coder:free qwen3 coder (free) openrouter qwen/qwen3-coder:free"
    );
  });
});
