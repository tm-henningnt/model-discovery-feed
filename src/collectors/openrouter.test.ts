import { describe, expect, it } from "vitest";
import { openrouterCollector } from "./openrouter";
import type { CollectorContext } from "./types";

const capturedPayloadExcerpt = {
  data: [
    {
      id: "openai/gpt-5.6-luna",
      canonical_slug: "openai/gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      context_length: 128000,
      pricing: { prompt: "0.000001", completion: "0.000004" },
      top_provider: { max_completion_tokens: 16384 },
      benchmarks: {
        artificial_analysis: {
          intelligence_index: 51.2,
          coding_index: 71.4,
          agentic_index: 45.6,
          math_index: 68.3,
          mmlu_pro: 77.9
        },
        design_arena: [
          { arena: "lmarena", category: "text", elo: 1286, win_rate: 0.58, rank: 7 }
        ]
      }
    },
    {
      id: "openai/unscored-model",
      name: "Unscored Model",
      context_length: 4096,
      pricing: { prompt: "0", completion: "0" }
    }
  ]
};

function createContext(): CollectorContext {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify(capturedPayloadExcerpt), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  return {
    now: new Date("2026-07-11T00:00:00.000Z"),
    fetch: fakeFetch,
    env: { OPENROUTER_API_KEY: "or_test_key" }
  };
}

describe("openrouterCollector", () => {
  it("maps embedded benchmarks verbatim and records high-confidence source claims", async () => {
    const result = await openrouterCollector.collect(createContext());
    const model = result.models.find((candidate) => candidate.id === "openrouter:openai/gpt-5.6-luna");

    expect(model?.quality).toEqual({
      coding_score: 71.4,
      reasoning_score: 51.2,
      agentic_score: 45.6,
      speed_score: null,
      benchmarks: {
        math_score: 68.3,
        ttft_seconds: null,
        artificial_analysis: {
          intelligence_index: 51.2,
          coding_index: 71.4,
          agentic_index: 45.6,
          math_index: 68.3,
          mmlu_pro: 77.9
        },
        design_arena: [
          { arena: "lmarena", category: "text", elo: 1286, win_rate: 0.58, rank: 7 }
        ]
      },
      recommendation_notes: []
    });

    expect(model?.source_claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_type: "third_party_catalog",
        source_url: "https://artificialanalysis.ai/",
        confidence: "high",
        field_paths: [
          "quality.coding_score",
          "quality.reasoning_score",
          "quality.agentic_score",
          "quality.benchmarks.math_score",
          "quality.benchmarks.artificial_analysis"
        ],
        raw_reference: expect.objectContaining({ json_pointer: "/data/0/benchmarks/artificial_analysis" })
      }),
      expect.objectContaining({
        source_type: "third_party_catalog",
        source_url: "https://designarena.ai/",
        confidence: "high",
        field_paths: ["quality.benchmarks.design_arena"],
        raw_reference: expect.objectContaining({ json_pointer: "/data/0/benchmarks/design_arena" })
      })
    ]));
  });

  it("keeps every quality score null when the payload has no benchmarks", async () => {
    const result = await openrouterCollector.collect(createContext());
    const model = result.models.find((candidate) => candidate.id === "openrouter:openai/unscored-model");

    expect(model?.quality).toEqual({
      coding_score: null,
      reasoning_score: null,
      agentic_score: null,
      speed_score: null,
      benchmarks: null,
      recommendation_notes: []
    });
    expect(model?.source_claims).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source_type: "third_party_catalog" })
    ]));
  });
});
