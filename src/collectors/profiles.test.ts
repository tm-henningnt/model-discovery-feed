import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import { DELEGATION_PROFILE_IDS } from "../feed/ranking";
import { validateFeedDocument } from "../feed/schema";
import type { ModelOffering, Provider } from "../feed/schema";
import { mergeCollectorFeed } from "./index";

const GENERATED_AT = new Date("2026-07-25T12:00:00.000Z");

type ProfileModelOptions = {
  visibility?: ModelOffering["policy"]["visibility"];
  capabilities?: ModelOffering["capabilities"];
  pricingKind?: ModelOffering["pricing"]["kind"];
  codingScore?: number | null;
  agenticScore?: number | null;
  inputPrice?: number | null;
  outputPrice?: number | null;
};

// Built on the fixture's own offering so every field the schema requires
// (source_claims, endpoint, limits, etc.) is already valid; only the fields a
// given test cares about are overridden.
function profileModel(id: string, options: ProfileModelOptions = {}): ModelOffering {
  const base = structuredClone(exampleFeed.models[0]);
  const pricingKind = options.pricingKind ?? base.pricing.kind;

  return {
    ...base,
    id,
    display_name: id,
    provider_model_id: id,
    canonical_model: { ...base.canonical_model!, id },
    capabilities: options.capabilities ?? base.capabilities,
    pricing: {
      ...base.pricing,
      kind: pricingKind,
      input_usd_per_1m_tokens: options.inputPrice === undefined ? base.pricing.input_usd_per_1m_tokens : options.inputPrice,
      output_usd_per_1m_tokens: options.outputPrice === undefined ? base.pricing.output_usd_per_1m_tokens : options.outputPrice,
      free:
        pricingKind === "free"
          ? { ...base.pricing.free!, is_currently_free: true, last_verified_at: GENERATED_AT.toISOString() }
          : null
    },
    quality: {
      ...base.quality,
      coding_score: options.codingScore === undefined ? base.quality.coding_score : options.codingScore,
      agentic_score: options.agenticScore === undefined ? base.quality.agentic_score : options.agenticScore
    },
    policy: {
      ...base.policy,
      visibility: options.visibility ?? "listed"
    }
  };
}

function provider(): Provider {
  return structuredClone(exampleFeed.providers[0]);
}

describe("mergeCollectorFeed profile generation (issue #28)", () => {
  it("generates each of the four delegation profiles when an eligible offering exists", () => {
    const models = [
      profileModel("test:free-coder", {
        pricingKind: "free",
        capabilities: ["coding", "tool_use", "structured_output"],
        codingScore: 60
      }),
      profileModel("test:best-coder", {
        pricingKind: "paid",
        capabilities: ["coding", "tool_use"],
        codingScore: 90,
        inputPrice: 1,
        outputPrice: 2
      }),
      profileModel("test:best-agentic", {
        pricingKind: "paid",
        capabilities: ["coding", "tool_use", "structured_output"],
        agenticScore: 70,
        inputPrice: 1,
        outputPrice: 2
      }),
      profileModel("test:best-value", {
        pricingKind: "paid",
        capabilities: ["coding", "tool_use"],
        codingScore: 80,
        inputPrice: 1,
        outputPrice: 1
      })
    ];

    const merged = mergeCollectorFeed(structuredClone(exampleFeed), [provider()], models, [], GENERATED_AT);
    const profileIds = merged.profiles.map((profile) => profile.id).sort();

    expect(profileIds).toEqual([...DELEGATION_PROFILE_IDS].sort());
    expect(() => validateFeedDocument(merged)).not.toThrow();
  });

  it("omits a profile entirely, rather than emitting a null selection, when its pool is empty", () => {
    // No offering carries tool_use, so best-coder, best-agentic, and
    // best-value-coder's tool_use/agentic-score requirements are all unmet;
    // no offering is paid, so best-value-coder's pricing requirement also fails.
    const models = [
      profileModel("test:free-only", {
        pricingKind: "free",
        capabilities: ["coding"],
        codingScore: 60,
        agenticScore: null
      })
    ];

    const merged = mergeCollectorFeed(structuredClone(exampleFeed), [provider()], models, [], GENERATED_AT);

    expect(merged.profiles.some((profile) => profile.id === "best-coder")).toBe(false);
    expect(merged.profiles.some((profile) => profile.id === "best-agentic")).toBe(false);
    expect(merged.profiles.some((profile) => profile.id === "best-value-coder")).toBe(false);
    expect(merged.profiles.every((profile) => profile.selection.model_offering_id !== null)).toBe(true);
    expect(() => validateFeedDocument(merged)).not.toThrow();
  });

  it("never selects a hidden offering, even when it is the best-scoring candidate", () => {
    const hiddenBestScore = profileModel("test:hidden-best", {
      visibility: "hidden",
      pricingKind: "paid",
      capabilities: ["coding", "tool_use"],
      codingScore: 99,
      inputPrice: 1,
      outputPrice: 2
    });
    const listedSecondBest = profileModel("test:listed-second", {
      visibility: "listed",
      pricingKind: "paid",
      capabilities: ["coding", "tool_use"],
      codingScore: 50,
      inputPrice: 1,
      outputPrice: 2
    });

    const merged = mergeCollectorFeed(
      structuredClone(exampleFeed),
      [provider()],
      [hiddenBestScore, listedSecondBest],
      [],
      GENERATED_AT
    );

    const bestCoder = merged.profiles.find((profile) => profile.id === "best-coder");
    expect(bestCoder?.selection.model_offering_id).toBe(listedSecondBest.id);
    expect(() => validateFeedDocument(merged)).not.toThrow();
  });

  it("sets selected_at to the run's generatedAt and expires_at to generatedAt plus default_stale_after_seconds", () => {
    const baseFeed = structuredClone(exampleFeed);
    const models = [
      profileModel("test:free-coder", {
        pricingKind: "free",
        capabilities: ["coding", "tool_use", "structured_output"],
        codingScore: 60
      })
    ];

    const merged = mergeCollectorFeed(baseFeed, [provider()], models, [], GENERATED_AT);
    const bestFreeCoder = merged.profiles.find((profile) => profile.id === "best-free-coder");

    expect(bestFreeCoder?.selection.selected_at).toBe(GENERATED_AT.toISOString());
    expect(bestFreeCoder?.selection.expires_at).toBe(
      new Date(GENERATED_AT.getTime() + baseFeed.feed.default_stale_after_seconds * 1000).toISOString()
    );
  });
});
