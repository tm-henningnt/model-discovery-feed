import { describe, expect, it } from "vitest";
import { groqCollector } from "./groq";
import type { CollectorContext } from "./types";

const sampleResponse = {
  object: "list",
  data: [
    {
      id: "openai/gpt-oss-20b",
      object: "model",
      created: 1754407957,
      owned_by: "OpenAI",
      active: true,
      context_window: 131072,
      public_apps: null,
      max_completion_tokens: 65536,
      hugging_face_id: "openai/gpt-oss-20b",
      name: "GPT OSS 20B",
      input_modalities: ["text"],
      output_modalities: ["text"],
      context_length: 131072,
      max_output_length: 65536,
      pricing: {
        prompt: "0.000000075",
        completion: "0.0000003",
        image: "0",
        request: "0",
        input_cache_read: "0.0000000375"
      },
      supported_sampling_parameters: ["temperature", "top_p", "stop", "seed", "max_tokens"],
      supported_features: ["tools", "json_mode", "structured_outputs", "reasoning"]
    },
    {
      id: "meta-llama/llama-4-scout-17b-16e-instruct",
      object: "model",
      created: 1743874824,
      owned_by: "Meta",
      active: true,
      context_window: 131072,
      max_completion_tokens: 8192,
      name: "Llama 4 Scout 17B",
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      context_length: 131072,
      max_output_length: 8192,
      pricing: {
        prompt: "0.00000011",
        completion: "0.00000034",
        image: "0",
        request: "0"
      },
      supported_features: ["tools", "json_mode"]
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
    const status = overrides.status ?? 200;
    return new Response(JSON.stringify(overrides.body ?? sampleResponse), {
      status,
      headers: { "content-type": "application/json" }
    });
  };

  return {
    now: new Date("2026-07-10T00:00:00.000Z"),
    fetch: fakeFetch,
    env: overrides.env ?? { GROQ_API_KEY: "gsk_test_key" }
  };
}

describe("groqCollector", () => {
  it("sends the GROQ_API_KEY as a bearer token", async () => {
    let authorization: string | null = null;
    const context = createContext({
      onRequest: (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization");
      }
    });

    await groqCollector.collect(context);

    expect(authorization).toBe("Bearer gsk_test_key");
  });

  it("returns every model in the live payload", async () => {
    const result = await groqCollector.collect(createContext({}));

    expect(result.models.map((model) => model.id)).toEqual([
      "groq:openai/gpt-oss-20b",
      "groq:meta-llama/llama-4-scout-17b-16e-instruct"
    ]);
    expect(result.notices).toEqual([]);
  });

  it("maps payload pricing to USD per 1M tokens", async () => {
    const result = await groqCollector.collect(createContext({}));

    const gptOss = result.models.find((model) => model.id === "groq:openai/gpt-oss-20b");
    expect(gptOss?.pricing.kind).toBe("paid");
    expect(gptOss?.pricing.input_usd_per_1m_tokens).toBeCloseTo(0.075, 6);
    expect(gptOss?.pricing.output_usd_per_1m_tokens).toBeCloseTo(0.3, 6);
    expect(gptOss?.pricing.currency).toBe("USD");
  });

  it("derives capabilities from supported_features and input_modalities", async () => {
    const result = await groqCollector.collect(createContext({}));

    const gptOss = result.models.find((model) => model.id === "groq:openai/gpt-oss-20b");
    expect(gptOss?.capabilities).toEqual(
      expect.arrayContaining(["tool_use", "structured_output", "reasoning"])
    );
    expect(gptOss?.capabilities).not.toContain("vision");

    const scout = result.models.find((model) => model.id === "groq:meta-llama/llama-4-scout-17b-16e-instruct");
    expect(scout?.capabilities).toEqual(expect.arrayContaining(["tool_use", "structured_output", "vision"]));
  });

  it("reports a notice including key presence when the request fails", async () => {
    const result = await groqCollector.collect(
      createContext({ status: 401, body: { error: { message: "Invalid API Key" } }, env: {} })
    );

    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "groq", message: "collector unavailable", has_api_key: false })
    ]);
  });
});
