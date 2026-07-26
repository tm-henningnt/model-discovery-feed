import { describe, expect, it } from "vitest";
import { exampleFeed } from "./fixture";
import type { ModelOffering } from "./schema";
import { computeFacetCounts, filterExplorerModels, type ExplorerFilters } from "./facets";

const NOW = new Date("2026-07-08T12:30:00.000Z");

const noFilters: ExplorerFilters = {
  query: "",
  freeOnly: false,
  providers: new Set(),
  planEditions: new Set(),
  capabilities: new Set(),
  pricing: new Set(),
  availability: new Set(),
  protocols: new Set(),
  minContext: 0
};

function cloneModel(overrides: {
  id: string;
  providerId?: string;
  capabilities?: string[];
  pricingKind?: "free" | "paid" | "unknown" | "subscription_included";
  availability?: "available" | "limited";
  planEditions?: string[];
}): ModelOffering {
  const base = structuredClone(exampleFeed.models[1]); // groq gpt-oss-120b, pricing unknown
  base.id = overrides.id;
  if (overrides.providerId) {
    base.provider = { id: overrides.providerId, name: overrides.providerId };
  }
  if (overrides.capabilities) {
    base.capabilities = overrides.capabilities as ModelOffering["capabilities"];
  }
  if (overrides.pricingKind) {
    base.pricing.kind = overrides.pricingKind;
    base.pricing.free = null;
  }
  if (overrides.availability) {
    base.availability.status = overrides.availability;
  }
  if (overrides.planEditions) {
    base.pricing.subscription = { billing: "flat_monthly", plan_editions: overrides.planEditions };
  }
  return base;
}

// gemini-a: gemini / chat+vision / paid; gemini-b: gemini / chat / unknown, limited
const models: ModelOffering[] = [
  ...structuredClone(exampleFeed.models),
  cloneModel({ id: "gemini:a", providerId: "gemini", capabilities: ["chat", "vision"], pricingKind: "paid" }),
  cloneModel({ id: "gemini:b", providerId: "gemini", capabilities: ["chat"], availability: "limited" })
];

// A plan sold in two editions, where the smaller edition's roster is a subset of the larger one.
const planModels: ModelOffering[] = [
  cloneModel({
    id: "plan:both",
    providerId: "token-plan",
    pricingKind: "subscription_included",
    planEditions: ["personal", "team"]
  }),
  cloneModel({
    id: "plan:team-only",
    providerId: "token-plan",
    pricingKind: "subscription_included",
    planEditions: ["team"]
  }),
  cloneModel({ id: "plan:payg", providerId: "token-plan", pricingKind: "paid" })
];

describe("filterExplorerModels", () => {
  it("applies every facet additively", () => {
    const results = filterExplorerModels(
      models,
      { ...noFilters, providers: new Set(["gemini"]), capabilities: new Set(["vision"]) },
      NOW
    );
    expect(results.map((m) => m.id)).toEqual(["gemini:a"]);
  });

  it("returns everything when no filters are active", () => {
    expect(filterExplorerModels(models, noFilters, NOW)).toHaveLength(models.length);
  });

  it("keeps only the offerings a selected plan edition covers", () => {
    const results = filterExplorerModels(planModels, { ...noFilters, planEditions: new Set(["personal"]) }, NOW);
    expect(results.map((m) => m.id)).toEqual(["plan:both"]);
  });

  it("unions the rosters of several selected editions (OR semantics)", () => {
    const results = filterExplorerModels(
      planModels,
      { ...noFilters, planEditions: new Set(["personal", "team"]) },
      NOW
    );
    expect(results.map((m) => m.id)).toEqual(["plan:both", "plan:team-only"]);
  });

  it("excludes an offering that is not sold through a plan", () => {
    const results = filterExplorerModels(planModels, { ...noFilters, planEditions: new Set(["team"]) }, NOW);
    expect(results.map((m) => m.id)).not.toContain("plan:payg");
  });
});

describe("computeFacetCounts", () => {
  it("counts the full universe when nothing is selected", () => {
    const counts = computeFacetCounts(models, noFilters, NOW);
    expect(counts.providers.get("gemini")).toBe(2);
    expect(counts.providers.get("openrouter")).toBe(1);
    expect(counts.capabilities.get("chat")).toBe(4);
  });

  it("does not restrict a facet by its own selection", () => {
    const counts = computeFacetCounts(models, { ...noFilters, providers: new Set(["gemini"]) }, NOW);
    // Other providers keep their would-be counts so the user can switch.
    expect(counts.providers.get("openrouter")).toBe(1);
    expect(counts.providers.get("groq")).toBe(1);
    // But other facets are restricted by the provider selection.
    expect(counts.capabilities.get("vision")).toBe(1);
    expect(counts.capabilities.get("coding")).toBeUndefined();
    expect(counts.pricing.get("paid")).toBe(1);
    expect(counts.availability.get("limited")).toBe(1);
  });

  it("keeps selected capabilities applied (AND semantics)", () => {
    const counts = computeFacetCounts(models, { ...noFilters, capabilities: new Set(["vision"]) }, NOW);
    // Only gemini:a has vision, so every capability count is scoped to it.
    expect(counts.capabilities.get("vision")).toBe(1);
    expect(counts.capabilities.get("chat")).toBe(1);
    expect(counts.capabilities.get("coding")).toBeUndefined();
    expect(counts.providers.get("gemini")).toBe(1);
    expect(counts.providers.get("openrouter")).toBeUndefined();
  });

  it("restricts every facet by the text query", () => {
    const counts = computeFacetCounts(models, { ...noFilters, query: "qwen" }, NOW);
    expect(counts.providers.get("openrouter")).toBe(1);
    expect(counts.providers.get("gemini")).toBeUndefined();
    expect(counts.pricing.get("free")).toBe(1);
  });

  it("counts each plan edition without restricting it by its own selection", () => {
    const counts = computeFacetCounts(planModels, { ...noFilters, planEditions: new Set(["personal"]) }, NOW);
    // Team keeps its would-be count so the user can see what switching would show.
    expect(counts.planEditions.get("personal")).toBe(1);
    expect(counts.planEditions.get("team")).toBe(2);
    // Other facets are restricted by the edition selection.
    expect(counts.pricing.get("subscription_included")).toBe(1);
    expect(counts.pricing.get("paid")).toBeUndefined();
  });

  it("restricts the plan-edition counts by the provider selection", () => {
    const counts = computeFacetCounts([...planModels, ...models], { ...noFilters, providers: new Set(["gemini"]) }, NOW);
    expect(counts.planEditions.size).toBe(0);
  });

  it("cross-restricts independent facets while skipping their own", () => {
    const counts = computeFacetCounts(
      models,
      { ...noFilters, pricing: new Set(["paid"]), providers: new Set(["gemini"]) },
      NOW
    );
    // Pricing facet: gemini-only universe → 1 paid, 1 unknown.
    expect(counts.pricing.get("paid")).toBe(1);
    expect(counts.pricing.get("unknown")).toBe(1);
    // Provider facet: paid-only universe → only gemini has a paid model.
    expect(counts.providers.get("gemini")).toBe(1);
    expect(counts.providers.get("groq")).toBeUndefined();
  });
});
