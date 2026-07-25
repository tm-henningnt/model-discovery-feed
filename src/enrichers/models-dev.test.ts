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
  },
  "opencode-go": {
    models: {
      "minimax-m3": {
        id: "minimax-m3",
        name: "MiniMax M3",
        reasoning: true,
        tool_call: true,
        limit: { context: 1_000_000, output: 131_072 },
        cost: { input: 0.3, output: 1.2, cache_read: 0.06 }
      }
    }
  },
  alibaba: {
    models: {
      "qwen3-coder-plus": {
        id: "qwen3-coder-plus",
        name: "Qwen3 Coder Plus",
        tool_call: true,
        limit: { context: 1_000_000, output: 65_536 },
        cost: { input: 1, output: 5 }
      },
      "wan2.7-image": {
        id: "wan2.7-image",
        name: "Wan 2.7 Image",
        limit: { context: 8_192, output: 8_192 },
        cost: { input: 0.03, output: 0.03 }
      }
    }
  },
  "alibaba-token-plan": {
    models: {
      "glm-5.2": {
        id: "glm-5.2",
        name: "GLM 5.2",
        reasoning: true,
        tool_call: true,
        limit: { context: 1_000_000, output: 131_072 },
        cost: { input: 0, output: 0 }
      }
    }
  },
  opencode: {
    models: {
      "deepseek-v4-flash-free": {
        id: "deepseek-v4-flash-free",
        name: "DeepSeek V4 Flash Free",
        reasoning: true,
        tool_call: true,
        limit: { context: 200_000, output: 128_000 },
        cost: { input: 0, output: 0 }
      }
    }
  }
} satisfies ModelsDevResponse;

function nullPricedOffering(providerId: string, providerModelId: string): ModelOffering {
  const model = offering(providerId, providerModelId);
  model.capabilities = ["chat", "streaming"];
  model.limits = { context_tokens: null, max_output_tokens: null };
  model.pricing = {
    kind: "unknown",
    input_usd_per_1m_tokens: null,
    output_usd_per_1m_tokens: null,
    currency: null,
    metering: "tokens",
    free: null
  };
  return model;
}

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
    // Non-null pricing matching the fixture so the pricing gap-fill is a no-op here — this test is
    // about capability/limit/canonical fill (pricing fill is covered separately below).
    gemini.pricing = {
      ...gemini.pricing,
      kind: "paid",
      input_usd_per_1m_tokens: 1.25,
      output_usd_per_1m_tokens: 10,
      currency: "USD"
    };
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

  it("gap-fills pricing from models.dev for a provider whose API carries none (OpenCode Go)", async () => {
    const go = nullPricedOffering("opencode-go", "minimax-m3");
    go.pricing = {
      ...go.pricing,
      kind: "subscription_included",
      subscription: { billing: "flat_monthly", per_token_billed: false, reference_pricing: true }
    };
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [go], context: context(successfulFetch) });

    expect(result.models[0]?.pricing).toMatchObject({
      kind: "subscription_included",
      input_usd_per_1m_tokens: 0.3,
      output_usd_per_1m_tokens: 1.2,
      currency: "USD",
      subscription: { billing: "flat_monthly", per_token_billed: false, reference_pricing: true }
    });
    expect(result.models[0]?.capabilities).toEqual(expect.arrayContaining(["tool_use", "reasoning"]));
    const claim = result.models[0]?.source_claims.find((c) => c.collector === "models-dev");
    expect(claim?.field_paths).toEqual(expect.arrayContaining([
      "pricing.input_usd_per_1m_tokens",
      "pricing.output_usd_per_1m_tokens"
    ]));
    expect(claim?.field_paths).not.toContain("pricing.kind");
    expect(result.notices).toEqual([]);
  });

  it("gap-fills pricing for Gemini, whose listing API carries none", async () => {
    const gemini = nullPricedOffering("gemini", "gemini-2.5-pro");
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [gemini], context: context(successfulFetch) });

    expect(result.models[0]?.pricing).toMatchObject({
      kind: "paid",
      input_usd_per_1m_tokens: 1.25,
      output_usd_per_1m_tokens: 10,
      currency: "USD"
    });
    expect(result.notices).toEqual([]);
  });

  it("marks a zero-cost OpenCode Zen model free with a populated free block", async () => {
    const zen = nullPricedOffering("opencode-zen", "deepseek-v4-flash-free");
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [zen], context: context(successfulFetch) });

    expect(result.models[0]?.pricing.kind).toBe("free");
    expect(result.models[0]?.pricing.input_usd_per_1m_tokens).toBe(0);
    expect(result.models[0]?.pricing.free).toMatchObject({
      is_currently_free: true,
      basis: "zero_priced_model",
      confidence: "medium"
    });
    const claim = result.models[0]?.source_claims.find((c) => c.collector === "models-dev");
    expect(claim?.field_paths).toEqual(expect.arrayContaining(["pricing.kind", "pricing.free"]));
  });

  it("gap-fills pricing and limits for QwenCloud from the models.dev `alibaba` provider", async () => {
    const qwencloud = nullPricedOffering("qwencloud", "qwen3-coder-plus");
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [qwencloud], context: context(successfulFetch) });

    expect(result.models[0]?.pricing).toMatchObject({
      kind: "paid",
      input_usd_per_1m_tokens: 1,
      output_usd_per_1m_tokens: 5,
      currency: "USD"
    });
    expect(result.models[0]?.limits).toMatchObject({ context_tokens: 1_000_000 });
    expect(result.models[0]?.capabilities).toEqual(expect.arrayContaining(["tool_use"]));
  });

  it("skips pricing gap-fill when the provider bills in a unit other than tokens", async () => {
    // wan2.7-image is billed per image, so a single models.dev number must not land in the
    // per-1M-token fields and contradict `pricing.metering`.
    const image = nullPricedOffering("qwencloud", "wan2.7-image");
    image.pricing = { ...image.pricing, kind: "paid", metering: "images", currency: "USD" };
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [image], context: context(successfulFetch) });

    expect(result.models[0]?.pricing.input_usd_per_1m_tokens).toBeNull();
    expect(result.models[0]?.pricing.output_usd_per_1m_tokens).toBeNull();
    // Non-pricing gap-fill still applies.
    expect(result.models[0]?.limits).toMatchObject({ context_tokens: 8_192 });
  });

  it("never gap-fills the Token Plan's zero subscription cost onto its offerings", async () => {
    const tokenPlan = nullPricedOffering("qwencloud-token-plan", "glm-5.2");
    tokenPlan.pricing = {
      ...tokenPlan.pricing,
      kind: "subscription_included",
      metering: "credits",
      subscription: { billing: "flat_monthly", per_token_billed: false, credits_metered: true }
    };
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [tokenPlan], context: context(successfulFetch) });

    expect(result.models[0]?.pricing).toMatchObject({
      kind: "subscription_included",
      input_usd_per_1m_tokens: null,
      output_usd_per_1m_tokens: null,
      metering: "credits"
    });
    // Capabilities and limits still gap-fill from the subscription roster.
    expect(result.models[0]?.capabilities).toEqual(expect.arrayContaining(["reasoning", "tool_use"]));
    expect(result.models[0]?.limits).toMatchObject({ context_tokens: 1_000_000 });
  });

  it("does not gap-fill pricing for a provider not on the pricing allow-list", async () => {
    // groq is not in pricingGapFillAllowed; a null price stays null even though models.dev has a cost.
    const groq = nullPricedOffering("groq", "openai/gpt-oss-120b");
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [groq], context: context(successfulFetch) });

    expect(result.models[0]?.pricing.input_usd_per_1m_tokens).toBeNull();
    expect(result.models[0]?.pricing.kind).toBe("unknown");
    expect(result.models[0]?.source_claims.find((c) => c.collector === "models-dev")?.field_paths).not.toContain(
      "pricing.input_usd_per_1m_tokens"
    );
  });

  it("never overrides a non-null first-party OpenCode price (fills output-only, notices on the input delta)", async () => {
    const go = nullPricedOffering("opencode-go", "minimax-m3");
    // Simulate a first-party input price present but output missing.
    go.pricing = { ...go.pricing, kind: "paid", input_usd_per_1m_tokens: 0.9, currency: "USD" };
    const successfulFetch: typeof fetch = async () =>
      new Response(JSON.stringify(capturedPayloadExcerpt), { status: 200 });

    const result = await enrichWithModelsDev({ models: [go], context: context(successfulFetch) });

    // Input preserved (0.9, not models.dev's 0.3); output gap-filled.
    expect(result.models[0]?.pricing.input_usd_per_1m_tokens).toBe(0.9);
    expect(result.models[0]?.pricing.output_usd_per_1m_tokens).toBe(1.2);
    // 0.9 vs 0.3 is a >20% delta on the non-null first-party value → mismatch notice.
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "models-dev", message: "models-dev pricing mismatch" })
    ]);
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
