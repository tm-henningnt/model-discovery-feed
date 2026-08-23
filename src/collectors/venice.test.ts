import { describe, expect, it } from "vitest";
import { veniceCollector } from "./venice";
import type { CollectorContext } from "./types";

const sampleResponse = {
  object: "list",
  type: "all",
  data: [
    {
      context_length: 1000000,
      created: 1783555200,
      id: "gemini-3-6-flash",
      object: "model",
      owned_by: "venice.ai",
      type: "text",
      model_spec: {
        name: "Gemini 3.6 Flash",
        description: "A high speed thinking model.",
        availableContextTokens: 1000000,
        maxCompletionTokens: 65536,
        offline: false,
        privacy: "anonymized",
        traits: [],
        capabilities: {
          optimizedForCode: false,
          quantization: "not-available",
          supportsAudioInput: true,
          supportsFunctionCalling: true,
          supportsLogProbs: false,
          supportsReasoning: true,
          supportsResponseSchema: true,
          supportsTeeAttestation: false,
          supportsE2EE: false,
          supportsVideoInput: true,
          supportsVision: true,
          supportsWebSearch: true
        },
        pricing: {
          input: { usd: 1.875, diem: 1.875 },
          cache_input: { usd: 0.1875, diem: 0.1875 },
          output: { usd: 9.375, diem: 9.375 }
        }
      }
    },
    {
      created: 1770000000,
      id: "stealth-ox-alpha",
      object: "model",
      owned_by: "venice.ai",
      type: "text",
      model_spec: {
        name: "Ox Alpha",
        availableContextTokens: 262144,
        maxCompletionTokens: 32768,
        offline: false,
        privacy: "anonymized",
        traits: [],
        capabilities: {
          optimizedForCode: true,
          quantization: "fp8",
          supportsFunctionCalling: true,
          supportsReasoning: false,
          supportsResponseSchema: false,
          supportsVision: false,
          supportsWebSearch: false
        },
        pricing: {
          input: { usd: 0, diem: 0 },
          output: { usd: 0, diem: 0 }
        }
      }
    },
    {
      created: 1741924661,
      id: "text-embedding-bge-m3",
      object: "model",
      owned_by: "venice.ai",
      type: "embedding",
      model_spec: {
        name: "BGE-M3",
        embeddingDimensions: 1024,
        maxInputTokens: 8192,
        offline: false,
        privacy: "private",
        traits: [],
        pricing: {
          input: { usd: 0.15, diem: 0.15 },
          output: { usd: 0.6, diem: 0.6 }
        }
      }
    },
    {
      created: 1760136444,
      id: "nvidia/parakeet-tdt-0.6b-v3",
      object: "model",
      owned_by: "venice.ai",
      type: "asr",
      model_spec: {
        name: "Parakeet ASR",
        offline: false,
        privacy: "private",
        traits: [],
        pricing: { per_audio_second: { usd: 0.0001, diem: 0.0001 } }
      }
    },
    {
      created: 1743099022,
      id: "venice-sd35",
      object: "model",
      owned_by: "venice.ai",
      type: "image",
      model_spec: {
        name: "Venice SD35",
        offline: false,
        privacy: "private",
        traits: ["eliza-default"],
        pricing: {
          generation: { usd: 0.01, diem: 0.01 },
          upscale: { "2x": { usd: 0.02, diem: 0.02 } }
        }
      }
    },
    {
      created: 1780000000,
      id: "sora-2-text-to-video",
      object: "model",
      owned_by: "venice.ai",
      type: "video",
      model_spec: {
        name: "Sora 2 Text to Video",
        offline: false,
        privacy: "anonymized",
        traits: [],
        deprecation: {
          autoRemap: false,
          date: "2026-09-24T00:00:00.000Z",
          removesAt: "2026-09-24T00:00:00.000Z"
        }
      }
    },
    {
      created: 1780000001,
      id: "retired-video",
      object: "model",
      owned_by: "venice.ai",
      type: "video",
      model_spec: {
        name: "Retired Video",
        offline: false,
        privacy: "anonymized",
        traits: [],
        deprecation: {
          autoRemap: false,
          date: "2026-06-01T00:00:00.000Z",
          removesAt: "2026-06-01T00:00:00.000Z"
        }
      }
    },
    {
      created: 1780000002,
      id: "future-modality",
      object: "model",
      owned_by: "venice.ai",
      type: "hologram",
      model_spec: { name: "Hologram", privacy: "private", traits: [] }
    }
  ]
};

function createContext(overrides: {
  env?: Record<string, string | undefined>;
  onRequest?: (url: string, init: RequestInit | undefined) => void;
  status?: number;
  body?: unknown;
}): CollectorContext {
  const fakeFetch: typeof fetch = async (input, init) => {
    overrides.onRequest?.(String(input), init);
    return new Response(JSON.stringify(overrides.body ?? sampleResponse), {
      status: overrides.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };

  return {
    now: new Date("2026-08-23T00:00:00.000Z"),
    fetch: fakeFetch,
    env: overrides.env ?? { VENICE_AI_API_KEY: "vk_test_key" }
  };
}

describe("veniceCollector", () => {
  it("requests every model type and sends the VENICE_AI_API_KEY as a bearer token", async () => {
    let url: string | null = null;
    let authorization: string | null = null;
    const context = createContext({
      onRequest: (requestUrl, init) => {
        url = requestUrl;
        authorization = new Headers(init?.headers).get("authorization");
      }
    });

    await veniceCollector.collect(context);

    expect(url).toBe("https://api.venice.ai/api/v1/models?type=all");
    expect(authorization).toBe("Bearer vk_test_key");
  });

  it("skips an entry whose type the collector does not know, and reports it", async () => {
    const result = await veniceCollector.collect(createContext({}));

    expect(result.models.map((model) => model.id)).not.toContain("venice:future-modality");
    expect(result.models).toHaveLength(7);
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "venice",
        message: "skipped catalog entries with no id or an unknown type",
        skipped_count: 1,
        catalog_count: 8
      })
    ]);
  });

  it("reads a text price as USD per 1M tokens without rescaling it", async () => {
    const result = await veniceCollector.collect(createContext({}));
    const flash = result.models.find((model) => model.id === "venice:gemini-3-6-flash");

    expect(flash?.pricing.kind).toBe("paid");
    expect(flash?.pricing.input_usd_per_1m_tokens).toBeCloseTo(1.875, 6);
    expect(flash?.pricing.output_usd_per_1m_tokens).toBeCloseTo(9.375, 6);
    expect(flash?.pricing.currency).toBe("USD");
    expect(flash?.pricing.metering).toBe("tokens");
    expect(flash?.pricing.free).toBeNull();
  });

  it("derives text capabilities from the published capability flags", async () => {
    const result = await veniceCollector.collect(createContext({}));
    const flash = result.models.find((model) => model.id === "venice:gemini-3-6-flash");

    expect(flash?.capabilities).toEqual(
      expect.arrayContaining([
        "chat",
        "streaming",
        "tool_use",
        "structured_output",
        "reasoning",
        "vision",
        "speech_to_text"
      ])
    );
    expect(flash?.capabilities).not.toContain("coding");
    expect(flash?.endpoint.protocol).toBe("openai_chat_completions");
    expect(flash?.endpoint.base_url).toBe("https://api.venice.ai/api/v1");
    expect(flash?.limits).toEqual({ context_tokens: 1000000, max_output_tokens: 65536 });
    expect(flash?.policy.recommended_for_agentic_workflows).toBe(true);
  });

  it("reads a zero token rate as a high-confidence zero-priced free claim", async () => {
    const result = await veniceCollector.collect(createContext({}));
    const ox = result.models.find((model) => model.id === "venice:stealth-ox-alpha");

    expect(ox?.pricing.kind).toBe("free");
    expect(ox?.pricing.input_usd_per_1m_tokens).toBe(0);
    expect(ox?.pricing.free).toEqual(
      expect.objectContaining({
        is_currently_free: true,
        basis: "zero_priced_model",
        confidence: "high",
        last_verified_at: "2026-08-23T00:00:00.000Z"
      })
    );
    expect(ox?.capabilities).toContain("coding");
    expect(ox?.policy.tags).toContain("quantization-fp8");
  });

  it("meters an embedding model in tokens and keeps its input limit", async () => {
    const result = await veniceCollector.collect(createContext({}));
    const bge = result.models.find((model) => model.id === "venice:text-embedding-bge-m3");

    expect(bge?.capabilities).toEqual(["embeddings"]);
    expect(bge?.pricing.kind).toBe("paid");
    expect(bge?.pricing.input_usd_per_1m_tokens).toBeCloseTo(0.15, 6);
    expect(bge?.pricing.metering).toBe("tokens");
    expect(bge?.limits.context_tokens).toBe(8192);
    expect(bge?.endpoint.protocol).toBe("unknown");
    expect(bge?.endpoint.base_url).toBeNull();
    expect(bge?.policy.tags).toEqual(expect.arrayContaining(["embeddings", "privacy-private"]));
  });

  it("states paid with null token rates for a meter the contract cannot carry", async () => {
    const result = await veniceCollector.collect(createContext({}));

    const asr = result.models.find((model) => model.id === "venice:nvidia/parakeet-tdt-0.6b-v3");
    expect(asr?.capabilities).toEqual(["speech_to_text"]);
    expect(asr?.pricing).toEqual(
      expect.objectContaining({
        kind: "paid",
        input_usd_per_1m_tokens: null,
        output_usd_per_1m_tokens: null,
        currency: "USD",
        metering: "audio_seconds",
        free: null
      })
    );
    expect(asr?.source_claims[0]?.raw_reference).toEqual(
      expect.objectContaining({ unit_price_usd: 0.0001, unit_price_unit: "audio_seconds" })
    );

    const image = result.models.find((model) => model.id === "venice:venice-sd35");
    expect(image?.capabilities).toEqual(["image_generation"]);
    expect(image?.pricing.metering).toBe("images");
    expect(image?.source_claims[0]?.raw_reference).toEqual(
      expect.objectContaining({ unit_price_usd: 0.01, unit_price_unit: "images" })
    );
  });

  it("carries a video model with no capability term as a tagged offering", async () => {
    const result = await veniceCollector.collect(createContext({}));
    const sora = result.models.find((model) => model.id === "venice:sora-2-text-to-video");

    expect(sora?.capabilities).toEqual([]);
    expect(sora?.policy.tags).toContain("video-generation");
    expect(sora?.pricing.metering).toBe("video_seconds");
  });

  it("applies the published removal date as deprecated ahead of it and retired past it", async () => {
    const result = await veniceCollector.collect(createContext({}));

    expect(
      result.models.find((model) => model.id === "venice:sora-2-text-to-video")?.availability.status
    ).toBe("deprecated");
    expect(result.models.find((model) => model.id === "venice:retired-video")?.availability.status).toBe(
      "retired"
    );
    expect(
      result.models.find((model) => model.id === "venice:gemini-3-6-flash")?.availability.status
    ).toBe("available");
  });

  it("reports a notice including key presence when the request fails", async () => {
    const result = await veniceCollector.collect(
      createContext({ status: 401, body: { error: "Unauthorized" }, env: {} })
    );

    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "venice", message: "collector unavailable", has_api_key: false })
    ]);
  });
});
