import { describe, expect, it } from "vitest";
import { hasStaleFreeClaim } from "./classification";
import { exampleFeed } from "./fixture";
import {
  FASTEST_CODER_MIN_CODING_SCORE,
  blendedPricePer1M,
  compareNullableNumbersDescending,
  compareForBestAgentic,
  compareForBestCoder,
  compareForBestValueCoder,
  compareForFastestCoder,
  compareRecommended,
  selectBestAgentic,
  selectBestCoder,
  selectBestFreeCoder,
  selectBestValueCoder,
  selectFastestCoder
} from "./ranking";
import type { FeedDocument, ModelOffering } from "./schema";

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

  it("uses coding score only after the existing free-pricing and capability tiebreaks", () => {
    const lowerScore = rankingModel("free:lower-score", {
      codingScore: 50,
      pricingKind: "free",
      contextTokens: 131072
    });
    const higherScore = rankingModel("free:higher-score", {
      codingScore: 90,
      pricingKind: "free",
      contextTokens: 131072
    });
    const lowerPriorityPricing = rankingModel("free:lower-priority-pricing", {
      codingScore: 99,
      pricingKind: "free_tier",
      contextTokens: 131072
    });

    const feed = rankingFeed([lowerScore, higherScore, lowerPriorityPricing]);

    expect(selectBestFreeCoder(feed, FIXTURE_NOW)?.id).toBe(higherScore.id);
  });
});

describe("quality-first recommended ranking", () => {
  it("puts scored available offerings ahead of unscored ones at equal availability", () => {
    const scored = rankingModel("recommended:scored", { reasoningScore: 60, codingScore: 20 });
    const unscored = rankingModel("recommended:unscored", { reasoningScore: null, codingScore: null });

    expect([unscored, scored].sort((a, b) => compareRecommended(a, b, FIXTURE_NOW)).map((model) => model.id)).toEqual([
      scored.id,
      unscored.id
    ]);
  });

  it("sorts unknown prices after known prices", () => {
    const knownPrice = rankingModel("recommended:known-price", {
      reasoningScore: 60,
      codingScore: 80,
      inputPrice: 1,
      outputPrice: 3
    });
    const unknownPrice = rankingModel("recommended:unknown-price", {
      reasoningScore: 60,
      codingScore: 80,
      inputPrice: null,
      outputPrice: null
    });

    expect(blendedPricePer1M(unknownPrice, FIXTURE_NOW)).toBe(Number.POSITIVE_INFINITY);
    expect([unknownPrice, knownPrice].sort((a, b) => compareRecommended(a, b, FIXTURE_NOW)).map((model) => model.id)).toEqual([
      knownPrice.id,
      unknownPrice.id
    ]);
  });

  it("treats a confidently free offering as zero-priced in the blend", () => {
    const free = rankingModel("recommended:free", {
      pricingKind: "free",
      inputPrice: 9,
      outputPrice: 18
    });

    expect(blendedPricePer1M(free, FIXTURE_NOW)).toBe(0);
  });
});

describe("nullable score ordering", () => {
  it("keeps null scores after known scores", () => {
    expect(compareNullableNumbersDescending(80, 50)).toBeLessThan(0);
    expect(compareNullableNumbersDescending(50, 80)).toBeGreaterThan(0);
    expect(compareNullableNumbersDescending(50, null)).toBeLessThan(0);
    expect(compareNullableNumbersDescending(null, 50)).toBeGreaterThan(0);
  });
});

describe("delegation profiles", () => {
  it("enforces profile eligibility and orders its purpose-built fixture", () => {
    const models = [
      rankingModel("coder:cheap", { codingScore: 80, inputPrice: 5, outputPrice: 5 }),
      rankingModel("coder:expensive", { codingScore: 80, inputPrice: 10, outputPrice: 10 }),
      rankingModel("coder:no-tools", { codingScore: 99, capabilities: ["coding"] }),
      rankingModel("coder:unscored", { codingScore: null }),
      rankingModel("agentic:best", {
        codingScore: 60,
        agenticScore: 90,
        capabilities: ["coding", "tool_use", "structured_output"]
      }),
      rankingModel("agentic:runner-up", {
        codingScore: 50,
        agenticScore: 80,
        capabilities: ["coding", "tool_use", "structured_output"]
      }),
      rankingModel("agentic:no-structured-output", {
        codingScore: 70,
        agenticScore: 99,
        capabilities: ["coding", "tool_use"]
      }),
      rankingModel("fastest:eligible", {
        codingScore: FASTEST_CODER_MIN_CODING_SCORE,
        speedScore: 300,
        capabilities: ["coding"]
      }),
      rankingModel("fastest:runner-up", { codingScore: 50, speedScore: 200, capabilities: ["coding"] }),
      rankingModel("fastest:below-floor", {
        codingScore: FASTEST_CODER_MIN_CODING_SCORE - 1,
        speedScore: 500,
        capabilities: ["coding"]
      }),
      rankingModel("fastest:no-speed", { codingScore: 99, speedScore: null, capabilities: ["coding"] }),
      rankingModel("value:best", { codingScore: 80, capabilities: ["coding"], inputPrice: 1, outputPrice: 1 }),
      rankingModel("value:runner-up", { codingScore: 90, capabilities: ["coding"], inputPrice: 2, outputPrice: 2 }),
      rankingModel("value:free", {
        codingScore: 100,
        capabilities: ["coding"],
        pricingKind: "free",
        inputPrice: 0,
        outputPrice: 0
      }),
      rankingModel("value:unknown-price", {
        codingScore: 99,
        capabilities: ["coding"],
        inputPrice: null,
        outputPrice: null
      })
    ];
    const feed = rankingFeed(models);

    const bestCoderCandidates = models
      .filter((model) => model.capabilities.includes("tool_use") && model.quality.coding_score !== null)
      .sort(compareForBestCoder)
      .map((model) => model.id);
    expect(bestCoderCandidates.slice(0, 2)).toEqual(["coder:cheap", "coder:expensive"]);
    expect(bestCoderCandidates).not.toContain("coder:no-tools");
    expect(bestCoderCandidates).not.toContain("coder:unscored");
    expect(selectBestCoder(feed)?.id).toBe("coder:cheap");

    const bestAgenticCandidates = models
      .filter(
        (model) =>
          model.capabilities.includes("tool_use") &&
          model.capabilities.includes("structured_output") &&
          model.quality.agentic_score !== null
      )
      .sort(compareForBestAgentic)
      .map((model) => model.id);
    expect(bestAgenticCandidates.slice(0, 2)).toEqual(["agentic:best", "agentic:runner-up"]);
    expect(bestAgenticCandidates).not.toContain("agentic:no-structured-output");
    expect(selectBestAgentic(feed)?.id).toBe("agentic:best");

    const fastestCandidates = models
      .filter(
        (model) =>
          model.quality.coding_score !== null &&
          model.quality.coding_score >= FASTEST_CODER_MIN_CODING_SCORE &&
          model.quality.speed_score !== null
      )
      .sort(compareForFastestCoder)
      .map((model) => model.id);
    expect(fastestCandidates.slice(0, 2)).toEqual(["fastest:eligible", "fastest:runner-up"]);
    expect(fastestCandidates).not.toContain("fastest:below-floor");
    expect(fastestCandidates).not.toContain("fastest:no-speed");
    expect(selectFastestCoder(feed)?.id).toBe("fastest:eligible");

    const valueCandidates = models
      .filter(
        (model) =>
          model.pricing.kind === "paid" &&
          model.pricing.input_usd_per_1m_tokens !== null &&
          model.pricing.output_usd_per_1m_tokens !== null &&
          model.quality.coding_score !== null
      )
      .sort(compareForBestValueCoder)
      .map((model) => model.id);
    // value:best is 80 / 1 = 80; value:runner-up is 90 / 2 = 45.
    expect(valueCandidates.slice(0, 2)).toEqual(["value:best", "value:runner-up"]);
    expect(valueCandidates).not.toContain("value:free");
    expect(valueCandidates).not.toContain("value:unknown-price");
    expect(selectBestValueCoder(feed)?.id).toBe("value:best");
  });

  it("excludes a paid offering priced at literal $0 from best-value-coder instead of ranking it as infinite value", () => {
    const zeroPriced = rankingModel("value:zero-priced", {
      codingScore: 50,
      inputPrice: 0,
      outputPrice: 0
    });
    const genuinelyValuable = rankingModel("value:genuine", {
      codingScore: 50,
      inputPrice: 1,
      outputPrice: 1
    });
    const feed = rankingFeed([zeroPriced, genuinelyValuable]);

    expect(selectBestValueCoder(feed)?.id).toBe("value:genuine");

    const ranked = [zeroPriced, genuinelyValuable].sort(compareForBestValueCoder).map((m) => m.id);
    expect(ranked).toEqual(["value:genuine", "value:zero-priced"]);
  });

  it("returns no fastest-coder selection when no offering reaches the coding floor", () => {
    const feed = rankingFeed([
      rankingModel("fastest:below-floor-a", {
        codingScore: FASTEST_CODER_MIN_CODING_SCORE - 1,
        speedScore: 900
      }),
      rankingModel("fastest:below-floor-b", {
        codingScore: FASTEST_CODER_MIN_CODING_SCORE - 10,
        speedScore: 300
      })
    ]);

    expect(selectFastestCoder(feed)).toBeUndefined();
  });
});

const FIXTURE_NOW = new Date("2026-07-08T12:30:00.000Z");

type RankingModelOptions = {
  agenticScore?: number | null;
  capabilities?: ModelOffering["capabilities"];
  codingScore?: number | null;
  contextTokens?: number | null;
  inputPrice?: number | null;
  outputPrice?: number | null;
  pricingKind?: ModelOffering["pricing"]["kind"];
  reasoningScore?: number | null;
  speedScore?: number | null;
};

function rankingModel(id: string, options: RankingModelOptions = {}): ModelOffering {
  const base = structuredClone(exampleFeed.models[0]);
  const pricingKind = options.pricingKind ?? "paid";

  return {
    ...base,
    id,
    display_name: id,
    provider_model_id: id,
    canonical_model: {
      id,
      confidence: "high",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    capabilities: options.capabilities ?? ["coding", "tool_use"],
    limits: {
      ...base.limits,
      context_tokens: options.contextTokens ?? 131072
    },
    pricing: {
      ...base.pricing,
      kind: pricingKind,
      input_usd_per_1m_tokens: options.inputPrice === undefined ? 2 : options.inputPrice,
      output_usd_per_1m_tokens: options.outputPrice === undefined ? 4 : options.outputPrice,
      free:
        pricingKind === "free"
          ? {
              ...base.pricing.free!,
              is_currently_free: true,
              last_verified_at: "2026-07-08T12:00:00.000Z"
            }
          : null
    },
    quality: {
      ...base.quality,
      coding_score: options.codingScore ?? null,
      reasoning_score: options.reasoningScore ?? null,
      agentic_score: options.agenticScore ?? null,
      speed_score: options.speedScore ?? null
    }
  };
}

function rankingFeed(models: ModelOffering[]): FeedDocument {
  return {
    ...structuredClone(exampleFeed),
    models,
    profiles: []
  };
}

describe("profile comparators honor an injected clock", () => {
  // A free-priced-but-not-zero-cost offering whose free claim is fresh as of
  // one `now` and stale as of a later `now` — isConfidentlyFree flips, so
  // blendedPricePer1M flips between 0 (confidently free) and the real
  // non-zero blended price (stale). Before this fix, compareForBestCoder and
  // compareForBestValueCoder silently ignored their `now` argument and used
  // the real wall clock instead, so this scenario would rank identically
  // regardless of which `now` was passed in.
  function freeButPricedModel(id: string, codingScore: number): ModelOffering {
    const model = rankingModel(id, { codingScore, pricingKind: "free", inputPrice: 5, outputPrice: 5 });
    model.pricing.free = {
      ...model.pricing.free!,
      last_verified_at: "2026-07-08T12:00:00.000Z"
    };
    model.availability.stale_after_seconds = 3600;
    return model;
  }

  const freshNow = new Date("2026-07-08T12:10:00.000Z"); // claim is 10min old — fresh
  const staleNow = new Date("2026-07-08T14:00:00.000Z"); // claim is ~2h old — stale

  it("compareForBestCoder ranks by the price at the injected now, not the real wall clock", () => {
    const x = freeButPricedModel("coder:free-claim", 50);
    const y = rankingModel("coder:mid-priced", { codingScore: 50, inputPrice: 2, outputPrice: 2 });

    // Fresh: x's blended price is 0 (confidently free) < y's 2 -> x wins.
    expect([x, y].sort((a, b) => compareForBestCoder(a, b, freshNow))[0].id).toBe(x.id);
    // Stale: x's blended price is 5 (real, non-zero) > y's 2 -> y wins.
    expect([x, y].sort((a, b) => compareForBestCoder(a, b, staleNow))[0].id).toBe(y.id);
  });

  it("compareForBestValueCoder is unaffected because it requires pricing.kind === \"paid\", excluding free-kind offerings entirely", () => {
    // best-value-coder's predicate already excludes non-paid offerings, so
    // this comparator's now-sensitivity only matters for a paid offering
    // whose confidently-free status could vary — which cannot happen for a
    // "paid"-kind offering (isConfidentlyFree requires kind === "free").
    // This test documents that the fix's now-threading is inert for THIS
    // profile's real inputs, while still being uniformly correct.
    const paid = rankingModel("value:paid", { codingScore: 50, inputPrice: 2, outputPrice: 2 });
    expect(compareForBestValueCoder(paid, paid, freshNow)).toBe(0);
    expect(compareForBestValueCoder(paid, paid, staleNow)).toBe(0);
  });
});
