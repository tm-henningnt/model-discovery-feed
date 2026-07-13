import { describe, expect, it } from "vitest";
import { githubModelsCollector } from "./github-models";
import type { CollectorContext } from "./types";

const sampleResponse = [
  {
    id: "openai/gpt-4.1",
    name: "OpenAI GPT-4.1",
    publisher: "OpenAI",
    summary: "General purpose model",
    capabilities: ["streaming", "tool-calling"],
    limits: { max_input_tokens: 1_000_000, max_output_tokens: 32_768 },
    rate_limit_tier: "high",
    supported_input_modalities: ["text", "image"],
    supported_output_modalities: ["text"]
  },
  {
    id: "meta/llama-3.3-70b",
    name: "Llama 3.3 70B",
    summary: "Open model",
    capabilities: ["streaming"],
    limits: { max_input_tokens: 128_000, max_output_tokens: 8_192 },
    rate_limit_tier: "low",
    supported_input_modalities: ["text"],
    supported_output_modalities: ["text"]
  }
];

function createContext(body: unknown = sampleResponse): CollectorContext {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return { now: new Date("2026-07-13T00:00:00.000Z"), fetch: fakeFetch, env: {} };
}

describe("githubModelsCollector", () => {
  it("classifies every model as a rate-limited free tier with a quota note, not a per-token price", async () => {
    const result = await githubModelsCollector.collect(createContext());
    const gpt = result.models.find((m) => m.id === "github-models:openai/gpt-4.1");

    expect(gpt?.pricing.kind).toBe("free_tier");
    expect(gpt?.pricing.input_usd_per_1m_tokens).toBeNull();
    expect(gpt?.pricing.output_usd_per_1m_tokens).toBeNull();
    expect(gpt?.pricing.free).toMatchObject({
      is_currently_free: true,
      basis: "account_free_tier",
      requires_account: true,
      requires_api_key: true,
      requires_credit_card: false,
      quota: "rate-limited (tier: high)"
    });
    expect(gpt?.quality.recommendation_notes[0]).toContain("token-unit");
  });

  it("does not treat rate_limit_tier as an availability signal (a `low`-tier model is still available)", async () => {
    const result = await githubModelsCollector.collect(createContext());
    // Previously `rate_limit_tier === "low"` was mislabelled as `limited`; low-tier models actually get
    // the higher free allowance, and the tier is a QoS class, not an availability status.
    for (const model of result.models) {
      expect(model.availability.status).toBe("available");
    }
    const llama = result.models.find((m) => m.id === "github-models:meta/llama-3.3-70b");
    expect(llama?.pricing.free?.quota).toBe("rate-limited (tier: low)");
  });
});
