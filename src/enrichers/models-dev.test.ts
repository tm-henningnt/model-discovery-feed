import { describe, expect, it } from "vitest";
import type { CollectorContext } from "../collectors/types";
import { exampleFeed } from "../feed/fixture";
import type { ModelOffering } from "../feed/schema";
import { enrichWithModelsDev, type ModelsDevResponse } from "./models-dev";

const capturedPayloadExcerpt = {
  google: {
    models: {
      "gemini-2.5-pro": {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        attachment: true,
        reasoning: true,
        tool_call: true,
        knowledge: "2024-06",
        release_date: "2025-03-25",
        open_weights: false,
        limit: { context: 1_048_576, output: 65_536 },
        cost: { input: 1.25, output: 10 }
      }
    }
  },
  groq: {
    models: {
      "openai/gpt-oss-120b": {
        id: "openai/gpt-oss-120b",
        name: "GPT OSS 120B",
        attachment: true,
        reasoning: true,
        tool_call: true,
        knowledge: "2024-08",
        release_date: "2025-08-05",
        open_weights: true,
        limit: { context: 131_072, output: 32_768 },
        cost: { input: 1.25, output: 1 }
      }
    }
  }
} satisfies ModelsDevResponse;

function context(fetchImpl: typeof fetch, now = "2026-07-11T12:00:00.000Z"): CollectorContext {
  return {
    now: new Date(now),
    fetch: fetchImpl,
    env: {}
  };
}

function offering(providerId: string, providerModelId: string): ModelOffering {
  const model = structuredClone(exampleFeed.models[1]);
  model.id = `${providerId}:${providerModelId}`;
  model.provider = { id: providerId, name: providerId };
  model.provider_model_id = providerModelId;
  model.canonical_model = {
    id: providerModelId,
    confidence: "medium",
    knowledge_cutoff: null,
    release_date: null,
    open_weights: null
  };
  model.endpoint = { ...model.endpoint, model: providerModelId };
  return model;
}

describe("enrichWithModelsDev", () => {
  it("gap-fills Gemini capabilities and limits, records canonical metadata, and claims every filled field", async () => {
    const gemini = offering("gemini", "gemini-2.5-pro");
    gemini.capabilities = ["chat"];
    gemini.limits = { context_tokens: null, max_output_tokens: null };
    let fetchCount = 0;
    const successfulFetch: typeof fetch = async (input) => {
      fetchCount += 1;
      expect(String(input)).toBe("https://models.dev/api.json");
      return new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });
    };

    const result = await enrichWithModelsDev({ models: [gemini], context: context(successfulFetch) });

    expect(fetchCount).toBe(1);
    expect(result.notices).toEqual([]);
    expect(result.models[0]).toMatchObject({
      capabilities: ["chat", "tool_use", "reasoning", "vision"],
      limits: { context_tokens: 1_048_576, max_output_tokens: 65_536 },
      canonical_model: {
        knowledge_cutoff: "2024-06-01",
        release_date: "2025-03-25",
        open_weights: false
      }
    });
    expect(result.models[0]?.source_claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collector: "models-dev",
        source_type: "third_party_catalog",
        source_url: "https://models.dev/",
        observed_at: "2026-07-11T12:00:00.000Z",
        confidence: "medium",
        field_paths: [
          "capabilities",
          "limits.context_tokens",
          "limits.max_output_tokens",
          "canonical_model.knowledge_cutoff",
          "canonical_model.release_date",
          "canonical_model.open_weights"
        ],
        raw_reference: {
          snapshot_id: "models-dev-live-response",
          json_pointer: "/google/models/gemini-2.5-pro",
          provider_model_id: "gemini-2.5-pro"
        }
      })
    ]));
  });

  it("does not capability-fill providers that explicitly enumerate capabilities, fills only null limits, and notices on a pricing delta", async () => {
    const groq = offering("groq", "openai/gpt-oss-120b");
    groq.capabilities = ["chat"];
    groq.limits = { context_tokens: null, max_output_tokens: 4_096 };
    groq.pricing = {
      ...groq.pricing,
      kind: "paid",
      input_usd_per_1m_tokens: 1,
      output_usd_per_1m_tokens: 1,
      currency: "USD"
    };
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [groq], context: context(successfulFetch) });

    expect(result.models[0]).toMatchObject({
      capabilities: ["chat"],
      limits: { context_tokens: 131_072, max_output_tokens: 4_096 },
      pricing: { input_usd_per_1m_tokens: 1, output_usd_per_1m_tokens: 1 }
    });
    expect(result.models[0]?.capabilities).not.toContain("tool_use");
    expect(result.models[0]?.capabilities).not.toContain("reasoning");
    expect(result.models[0]?.capabilities).not.toContain("vision");
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "models-dev",
        message: "models-dev pricing mismatch",
        offering_id: "groq:openai/gpt-oss-120b",
        input: { provider: 1, models_dev: 1.25 },
        output: { provider: 1, models_dev: 1 }
      })
    ]);
  });

  it("preserves a pre-existing canonical_model value instead of overwriting it with models.dev's", async () => {
    const gemini = offering("gemini", "gemini-2.5-pro");
    gemini.canonical_model = {
      ...gemini.canonical_model!,
      knowledge_cutoff: "2020-01-01" // deliberately different from the fixture's 2024-06-01
    };
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [gemini], context: context(successfulFetch) });

    expect(result.models[0]?.canonical_model?.knowledge_cutoff).toBe("2020-01-01");
    // release_date/open_weights were still null, so those remain gap-filled.
    expect(result.models[0]?.canonical_model?.release_date).toBe("2025-03-25");
    expect(result.models[0]?.source_claims.find((c) => c.collector === "models-dev")?.field_paths).not.toContain(
      "canonical_model.knowledge_cutoff"
    );
  });

  it("skips enrichment without carry-forward when models.dev is unavailable", async () => {
    const gemini = offering("gemini", "gemini-2.5-pro");
    const unavailableFetch: typeof fetch = async () => new Response("unavailable", { status: 503 });

    const result = await enrichWithModelsDev({ models: [gemini], context: context(unavailableFetch) });

    expect(result.models).toEqual([gemini]);
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "models-dev",
        message: "models.dev unavailable",
        status: 503
      })
    ]);
  });
});
