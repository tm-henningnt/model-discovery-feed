import { describe, expect, it } from "vitest";
import type { CollectorContext } from "../collectors/types";
import { exampleFeed } from "../feed/fixture";
import type { ModelOffering } from "../feed/schema";
import { enrichWithArtificialAnalysis, type ArtificialAnalysisResponse } from "./artificial-analysis";

const capturedPayloadExcerpt: ArtificialAnalysisResponse = {
  status: "success",
  prompt_options: [],
  data: [
    {
      id: "aa-gpt-oss-120b-low",
      name: "gpt-oss-120b (low)",
      slug: "gpt-oss-120b-low",
      model_creator: { id: "openai", name: "OpenAI", slug: "openai" },
      evaluations: {
        artificial_analysis_intelligence_index: 63.25,
        artificial_analysis_coding_index: 72.75,
        artificial_analysis_math_index: 81.5,
        mmlu_pro: 77.1,
        gpqa: 68.2,
        hle: 22.4,
        livecodebench: 70.3,
        scicode: 44.5,
        math_500: 91.6,
        aime: 83.7,
        aime_25: 84.8,
        ifbench: 73.9,
        lcr: 58.1,
        terminalbench_hard: 39.2,
        terminalbench_v2_1: 40.3,
        tau2: 61.4,
        tau_banking: 62.5
      },
      median_output_tokens_per_second: 500,
      median_time_to_first_token_seconds: 0.12,
      median_time_to_first_answer_token: 0.24
    },
    {
      id: "aa-unmatched",
      name: "Unmatched Model",
      slug: "unmatched-model",
      model_creator: { id: "unknown", name: "Unknown Labs", slug: "unknown-labs" },
      evaluations: { artificial_analysis_coding_index: 99 }
    }
  ]
};

function scoredOffering(): ModelOffering {
  const model = structuredClone(exampleFeed.models[1]);
  model.id = "openrouter:openai/gpt-oss-120b";
  model.provider = { id: "openrouter", name: "OpenRouter" };
  model.provider_model_id = "openai/gpt-oss-120b";
  model.canonical_model = {
    id: "openai/gpt-oss-120b",
    confidence: "high",
    knowledge_cutoff: null,
    release_date: null,
    open_weights: null
  };
  model.quality = {
    coding_score: 10,
    reasoning_score: 20,
    agentic_score: 30,
    speed_score: 999,
    benchmarks: {
      math_score: 40,
      ttft_seconds: 9,
      artificial_analysis: { coding_index: 10, agentic_index: 30 },
      design_arena: [{ arena: "design", category: "code", elo: 1200, rank: 2, win_rate: 0.6 }]
    },
    recommendation_notes: []
  };
  model.source_claims.push({
    id: "embed-aa",
    collector: "openrouter",
    source_type: "third_party_catalog",
    source_url: "https://artificialanalysis.ai/",
    observed_at: "2026-07-10T00:00:00.000Z",
    field_paths: [
      "quality.coding_score",
      "quality.reasoning_score",
      "quality.agentic_score",
      "quality.benchmarks.math_score",
      "quality.benchmarks.artificial_analysis"
    ],
    confidence: "high",
    raw_reference: { snapshot_id: "openrouter-live-response" }
  });
  return model;
}

function context(fetchImpl: typeof fetch, now = "2026-07-11T12:00:00.000Z"): CollectorContext {
  return {
    now: new Date(now),
    fetch: fetchImpl,
    env: { ARTIFICIALANALYSIS_API_KEY: "aa_test_key" }
  };
}

const successfulFetch: typeof fetch = async (_input, init) => {
  expect(new Headers(init?.headers).get("x-api-key")).toBe("aa_test_key");
  return new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });
};

describe("enrichWithArtificialAnalysis", () => {
  it("maps direct evaluations verbatim, overwrites embed fields, and preserves agentic/design data", async () => {
    const result = await enrichWithArtificialAnalysis({
      models: [scoredOffering()],
      context: context(successfulFetch)
    });

    expect(result.snapshotToPersist).toEqual(capturedPayloadExcerpt);
    expect(result.notices).toEqual([
      expect.objectContaining({ unmatched_model_count: 1 })
    ]);
    expect(result.models[0]?.quality).toEqual({
      coding_score: 72.75,
      reasoning_score: 63.25,
      agentic_score: 30,
      speed_score: null,
      benchmarks: {
        math_score: 81.5,
        ttft_seconds: null,
        artificial_analysis: {
          mmlu_pro: 77.1,
          gpqa: 68.2,
          hle: 22.4,
          livecodebench: 70.3,
          scicode: 44.5,
          math_500: 91.6,
          aime: 83.7,
          aime_25: 84.8,
          ifbench: 73.9,
          lcr: 58.1,
          terminalbench_hard: 39.2,
          terminalbench_v2_1: 40.3,
          tau2: 61.4,
          tau_banking: 62.5
        },
        design_arena: [{ arena: "design", category: "code", elo: 1200, rank: 2, win_rate: 0.6 }]
      },
      recommendation_notes: []
    });

    const claims = result.models[0]?.source_claims ?? [];
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collector: "artificial-analysis",
        source_url: "https://artificialanalysis.ai/",
        observed_at: "2026-07-11T12:00:00.000Z",
        field_paths: [
          "quality.coding_score",
          "quality.reasoning_score",
          "quality.benchmarks.math_score",
          "quality.benchmarks.artificial_analysis"
        ],
        raw_reference: expect.objectContaining({ json_pointer: "/data/0/evaluations" })
      }),
      expect.objectContaining({
        id: "embed-aa",
        field_paths: ["quality.agentic_score"]
      })
    ]));
  });

  it("keeps speed and TTFT null on every offering because AA exposes no per-host measurements", async () => {
    const matching = scoredOffering();
    const unmatched = structuredClone(exampleFeed.models[0]);
    unmatched.quality.speed_score = 123;
    if (unmatched.quality.benchmarks) {
      unmatched.quality.benchmarks.ttft_seconds = 4;
    }

    const result = await enrichWithArtificialAnalysis({
      models: [matching, unmatched],
      context: context(successfulFetch)
    });

    for (const model of result.models) {
      expect(model.quality.speed_score).toBeNull();
      expect(model.quality.benchmarks).not.toBeNull();
      expect(model.quality.benchmarks?.ttft_seconds).toBeNull();
    }
  });

  it("picks the default (un-parenthesized) variant deterministically when AA lists multiple entries for one canonical model", async () => {
    const variantFirst: ArtificialAnalysisResponse = {
      status: "success",
      prompt_options: [],
      data: [
        {
          id: "aa-gpt-oss-120b-low",
          name: "gpt-oss-120b (low)",
          slug: "gpt-oss-120b-low",
          model_creator: { id: "openai", name: "OpenAI", slug: "openai" },
          evaluations: { artificial_analysis_intelligence_index: 99, artificial_analysis_coding_index: 99 }
        },
        {
          id: "aa-gpt-oss-120b",
          name: "gpt-oss-120b",
          slug: "gpt-oss-120b",
          model_creator: { id: "openai", name: "OpenAI", slug: "openai" },
          evaluations: { artificial_analysis_intelligence_index: 63.25, artificial_analysis_coding_index: 72.75 }
        }
      ]
    };
    const defaultFirst: ArtificialAnalysisResponse = {
      ...variantFirst,
      data: [...variantFirst.data].reverse()
    };

    const fetchFor = (payload: ArtificialAnalysisResponse): typeof fetch => async () =>
      new Response(JSON.stringify(payload), { status: 200 });

    const resultVariantFirst = await enrichWithArtificialAnalysis({
      models: [scoredOffering()],
      context: context(fetchFor(variantFirst))
    });
    const resultDefaultFirst = await enrichWithArtificialAnalysis({
      models: [scoredOffering()],
      context: context(fetchFor(defaultFirst))
    });

    for (const result of [resultVariantFirst, resultDefaultFirst]) {
      expect(result.models[0].quality.coding_score).toBe(72.75);
      expect(result.models[0].quality.reasoning_score).toBe(63.25);
    }

    // The winning entry is the default variant ("gpt-oss-120b", no parenthetical
    // suffix) regardless of order, but its position in each payload differs:
    // index 1 when it's listed second (variantFirst), index 0 when listed
    // first (defaultFirst). Provenance must track the WINNER's actual slot,
    // not whichever index the loop happened to be on when it won.
    const claimFor = (result: typeof resultVariantFirst) =>
      result.models[0].source_claims.find((c) => c.collector === "artificial-analysis");

    expect(claimFor(resultVariantFirst)?.raw_reference).toMatchObject({
      json_pointer: "/data/1/evaluations",
      artificial_analysis_model_id: "aa-gpt-oss-120b"
    });
    expect(claimFor(resultVariantFirst)?.id).toBe(
      "artificial-analysis:openrouter:openai/gpt-oss-120b:1"
    );

    expect(claimFor(resultDefaultFirst)?.raw_reference).toMatchObject({
      json_pointer: "/data/0/evaluations",
      artificial_analysis_model_id: "aa-gpt-oss-120b"
    });
    expect(claimFor(resultDefaultFirst)?.id).toBe(
      "artificial-analysis:openrouter:openai/gpt-oss-120b:0"
    );
  });

  it("uses an injected snapshot after fetch failure and keeps its original observed_at", async () => {
    const failedFetch: typeof fetch = async () => new Response("upstream unavailable", { status: 503 });
    const result = await enrichWithArtificialAnalysis({
      models: [scoredOffering()],
      context: context(failedFetch),
      fallbackSnapshot: {
        id: "snapshot-aa-1",
        observedAt: "2026-07-09T10:00:00.000Z",
        body: capturedPayloadExcerpt
      }
    });

    expect(result.usedSnapshot).toBe(true);
    expect(result.snapshotToPersist).toBeNull();
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "Artificial Analysis API unavailable", used_snapshot: true })
    ]));
    expect(result.models[0]?.source_claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collector: "artificial-analysis",
        observed_at: "2026-07-09T10:00:00.000Z",
        raw_reference: expect.objectContaining({ snapshot_id: "snapshot-aa-1" })
      })
    ]));
  });

  it("emits a notice when the fallback snapshot is more than seven days old", async () => {
    const failedFetch: typeof fetch = async () => new Response("upstream unavailable", { status: 503 });
    const result = await enrichWithArtificialAnalysis({
      models: [scoredOffering()],
      context: context(failedFetch, "2026-07-20T10:00:00.001Z"),
      fallbackSnapshot: {
        id: "snapshot-aa-old",
        observedAt: "2026-07-13T10:00:00.000Z",
        body: capturedPayloadExcerpt
      }
    });

    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "Artificial Analysis snapshot is more than 7 days old",
        observed_at: "2026-07-13T10:00:00.000Z"
      })
    ]));
  });

  it("keeps direct scores absent and emits a notice on DB-less fetch failure", async () => {
    const model = structuredClone(exampleFeed.models[1]);
    const failedFetch: typeof fetch = async () => new Response("upstream unavailable", { status: 503 });
    const result = await enrichWithArtificialAnalysis({
      models: [model],
      context: context(failedFetch)
    });

    expect(result.usedSnapshot).toBe(false);
    expect(result.models[0]?.quality).toMatchObject({
      coding_score: null,
      reasoning_score: null,
      speed_score: null,
      benchmarks: {
        math_score: null,
        ttft_seconds: null,
        artificial_analysis: null,
        design_arena: null
      }
    });
    expect(result.notices).toEqual([
      expect.objectContaining({ message: "Artificial Analysis API unavailable", used_snapshot: false })
    ]);
  });
});
