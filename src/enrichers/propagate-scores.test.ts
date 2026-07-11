import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { ModelOffering, SourceClaim } from "../feed/schema";
import { propagateScores } from "./propagate-scores";

const canonicalId = "meta-llama/llama-3.3-70b-instruct";

function claim(overrides: Partial<SourceClaim> = {}): SourceClaim {
  return {
    id: "collector:model",
    collector: "collector",
    source_type: "provider_api",
    source_url: "https://example.com/models",
    observed_at: "2026-07-11T12:00:00.000Z",
    field_paths: ["availability.status"],
    confidence: "high",
    raw_reference: { snapshot_id: "collector-response" },
    ...overrides
  };
}

function offering(id: string, confidence: "high" | "medium" = "high"): ModelOffering {
  const model = structuredClone(exampleFeed.models[0]);
  model.id = id;
  model.provider = {
    id: id.slice(0, id.indexOf(":")),
    name: id.slice(0, id.indexOf(":"))
  };
  model.provider_model_id = id.slice(id.indexOf(":") + 1);
  model.canonical_model = {
    id: canonicalId,
    confidence,
    knowledge_cutoff: null,
    release_date: null,
    open_weights: null
  };
  model.quality = {
    coding_score: null,
    reasoning_score: null,
    agentic_score: null,
    speed_score: null,
    benchmarks: {
      math_score: null,
      ttft_seconds: null,
      artificial_analysis: null,
      design_arena: null
    },
    recommendation_notes: []
  };
  model.source_claims = [claim({ id: `${id}:provider` })];
  return model;
}

function directDonor(): ModelOffering {
  const model = offering("openrouter:meta-llama/llama-3.3-70b-instruct");
  model.quality = {
    coding_score: 72.75,
    reasoning_score: 63.25,
    agentic_score: 44.5,
    speed_score: 500,
    benchmarks: {
      math_score: 81.5,
      ttft_seconds: 0.12,
      artificial_analysis: { mmlu_pro: 77.1, gpqa: 68.2 },
      design_arena: [{ arena: "overall", elo: 1240, rank: 8, win_rate: 0.58 }]
    },
    recommendation_notes: []
  };
  model.source_claims.push(
    claim({
      id: "artificial-analysis:openrouter-llama",
      collector: "artificial-analysis",
      source_type: "third_party_catalog",
      source_url: "https://artificialanalysis.ai/",
      field_paths: [
        "quality.coding_score",
        "quality.reasoning_score",
        "quality.agentic_score",
        "quality.benchmarks.math_score",
        "quality.benchmarks.artificial_analysis"
      ],
      raw_reference: { snapshot_id: "aa-response", json_pointer: "/data/4/evaluations" }
    }),
    claim({
      id: "design-arena:openrouter-llama",
      collector: "openrouter",
      source_type: "third_party_catalog",
      source_url: "https://designarena.ai/",
      field_paths: ["quality.benchmarks.design_arena"],
      raw_reference: {
        snapshot_id: "openrouter-response",
        json_pointer: "/data/9/benchmarks/design_arena"
      }
    })
  );
  return model;
}

describe("propagateScores", () => {
  it("copies intrinsic scores to a high-confidence provider twin with medium-confidence join claims", () => {
    const donor = directDonor();
    const groq = offering("groq:llama-3.3-70b-versatile");

    const result = propagateScores([donor, groq]);
    const propagated = result.models[1];

    expect(propagated?.quality).toEqual({
      coding_score: 72.75,
      reasoning_score: 63.25,
      agentic_score: 44.5,
      speed_score: null,
      benchmarks: {
        math_score: 81.5,
        ttft_seconds: null,
        artificial_analysis: { mmlu_pro: 77.1, gpqa: 68.2 },
        design_arena: [{ arena: "overall", elo: 1240, rank: 8, win_rate: 0.58 }]
      },
      recommendation_notes: []
    });
    expect(propagated?.source_claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: "third_party_catalog",
          source_url: "https://artificialanalysis.ai/",
          confidence: "medium",
          field_paths: ["quality.coding_score"],
          raw_reference: expect.objectContaining({
            donor_offering_id: donor.id,
            canonical_model_id: canonicalId
          })
        }),
        expect.objectContaining({
          source_type: "third_party_catalog",
          source_url: "https://designarena.ai/",
          confidence: "medium",
          field_paths: ["quality.benchmarks.design_arena"],
          raw_reference: expect.objectContaining({
            donor_offering_id: donor.id,
            canonical_model_id: canonicalId
          })
        })
      ])
    );
  });

  it("never copies endpoint speed or TTFT", () => {
    const result = propagateScores([
      directDonor(),
      offering("groq:llama-3.3-70b-versatile")
    ]);

    expect(result.models[1]?.quality.speed_score).toBeNull();
    expect(result.models[1]?.quality.benchmarks?.ttft_seconds).toBeNull();
    expect(result.models[1]?.source_claims.flatMap((item) => item.field_paths)).not.toContain(
      "quality.speed_score"
    );
    expect(result.models[1]?.source_claims.flatMap((item) => item.field_paths)).not.toContain(
      "quality.benchmarks.ttft_seconds"
    );
  });

  it("does not join a medium-confidence echo-id collision", () => {
    const echo = offering("groq:echo-collision", "medium");

    const result = propagateScores([directDonor(), echo]);

    expect(result.models[1]).toEqual(echo);
  });

  it("fills null fields only and never overwrites an existing value", () => {
    const groq = offering("groq:llama-3.3-70b-versatile");
    groq.quality.coding_score = 12.5;

    const result = propagateScores([directDonor(), groq]);

    expect(result.models[1]?.quality.coding_score).toBe(12.5);
    expect(result.models[1]?.quality.reasoning_score).toBe(63.25);
    expect(
      result.models[1]?.source_claims.some(
        (item) =>
          item.collector === "score-propagation" &&
          item.field_paths.includes("quality.coding_score")
      )
    ).toBe(false);
  });

  it("does not propagate a direct claim without an AA or Design Arena origin URL", () => {
    const donor = directDonor();
    const scoreClaim = donor.source_claims.find((item) =>
      item.field_paths.includes("quality.coding_score")
    );
    if (scoreClaim) {
      scoreClaim.source_url = null;
    }

    const result = propagateScores([
      donor,
      offering("groq:llama-3.3-70b-versatile")
    ]);

    expect(result.models[1]?.quality.coding_score).toBeNull();
  });

  it("prefers the Artificial-Analysis-sourced donor and emits a notice instead of aborting when donors disagree", () => {
    const artificialAnalysisDonor = directDonor();
    const conflicting = directDonor();
    conflicting.id = "openrouter:meta-llama/llama-3.3-70b-instruct:free";
    conflicting.provider_model_id = "meta-llama/llama-3.3-70b-instruct:free";
    conflicting.quality.coding_score = 12.5;
    conflicting.source_claims = conflicting.source_claims.map((item) => ({
      ...item,
      id: `${item.id}:conflicting`,
      // Still AA-sourced, so it's a genuine value disagreement between two
      // AA-attributed claims, not just a non-AA collector echoing a stale
      // number.
      source_url: "https://artificialanalysis.ai/"
    }));

    let result: ReturnType<typeof propagateScores> | undefined;
    expect(() => {
      result = propagateScores([
        artificialAnalysisDonor,
        conflicting,
        offering("groq:llama-3.3-70b-versatile")
      ]);
    }).not.toThrow();

    const recipient = result?.models.find((model) => model.id === "groq:llama-3.3-70b-versatile");
    expect(recipient?.quality.coding_score).toBe(artificialAnalysisDonor.quality.coding_score);
    expect(result?.notices).toEqual([
      expect.objectContaining({
        collector: "score-propagation",
        message: "conflicting direct intrinsic scores",
        canonical_model_id: canonicalId,
        field_path: "quality.coding_score",
        preferred_donor_offering_id: artificialAnalysisDonor.id,
        conflicting_donor_offering_ids: [conflicting.id]
      })
    ]);
  });

  it("prefers the non-variant offering id as donor provenance when multiple AA-sourced donors agree", () => {
    const baseDonor = directDonor();
    const variantDonor = directDonor();
    variantDonor.id = "openrouter:meta-llama/llama-3.3-70b-instruct:free";
    variantDonor.provider_model_id = "meta-llama/llama-3.3-70b-instruct:free";
    variantDonor.source_claims = variantDonor.source_claims.map((item) => ({
      ...item,
      id: `${item.id}:variant`
    }));

    // Variant appears first in array order — if donor selection were
    // order-dependent, provenance would (arbitrarily) point at the variant.
    const result = propagateScores([
      variantDonor,
      baseDonor,
      offering("groq:llama-3.3-70b-versatile")
    ]);

    const recipient = result.models.find((model) => model.id === "groq:llama-3.3-70b-versatile");
    const propagationClaim = recipient?.source_claims.find(
      (item) => item.collector === "score-propagation" && item.field_paths.includes("quality.coding_score")
    );
    expect(propagationClaim?.raw_reference).toMatchObject({ donor_offering_id: baseDonor.id });
    expect(result.notices).toEqual([]);
  });

  it("prefers the non-variant offering id for design_arena provenance too, not just AA-sourced fields", () => {
    const baseDonor = directDonor();
    const variantDonor = directDonor();
    variantDonor.id = "openrouter:meta-llama/llama-3.3-70b-instruct:free";
    variantDonor.provider_model_id = "meta-llama/llama-3.3-70b-instruct:free";
    variantDonor.source_claims = variantDonor.source_claims.map((item) => ({
      ...item,
      id: `${item.id}:variant`
    }));

    for (const [first, second] of [
      [variantDonor, baseDonor],
      [baseDonor, variantDonor]
    ]) {
      const result = propagateScores([first, second, offering("groq:llama-3.3-70b-versatile")]);

      const recipient = result.models.find((model) => model.id === "groq:llama-3.3-70b-versatile");
      const propagationClaim = recipient?.source_claims.find(
        (item) => item.collector === "score-propagation" && item.field_paths.includes("quality.benchmarks.design_arena")
      );
      expect(propagationClaim?.raw_reference).toMatchObject({ donor_offering_id: baseDonor.id });
      expect(result.notices).toEqual([]);
    }
  });

  it("is idempotent", () => {
    const once = propagateScores([
      directDonor(),
      offering("groq:llama-3.3-70b-versatile")
    ]);
    const twice = propagateScores(once.models);

    expect(twice).toEqual(once);
  });
});
