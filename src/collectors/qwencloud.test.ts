import { describe, expect, it } from "vitest";
import {
  MODEL_MAPPING_URL,
  PRICING_DOC_URL,
  TOKEN_PLAN_PERSONAL_DOC_URL,
  TOKEN_PLAN_TEAM_DOC_URL,
  parseTokenPlanRoster,
  parseTokenRates,
  qwencloudCollector,
  qwencloudTokenPlanCollector
} from "./qwencloud";
import type { CollectorContext } from "./types";

const modelMapping = {
  "qwen3.7-max": "sfm_inferenceglobal_public_intl_20260601222001_0696",
  "qwen3.7-plus": "sfm_inferenceglobal_public_intl_20260601222002_0697",
  "qwen3-vl-plus": "sfm_inferenceglobal_public_intl_20251109105402_0408",
  "wan2.7-image": "sfm_inferenceWan_public_intl_20260621214127_0590",
  "happyhorse-1.1-t2v": "sfm_inferenceHH_public_intl_20260621214127_0591",
  "qwen3-asr-flash": "sfm_inferenceQwenAudio_public_intl_20260203191214_0754",
  "qwen3-tts-flash": "sfm_inferenceQwenAudio_public_intl_20260203191215_0755",
  "text-embedding-v4": "sfm_inferenceglobal_public_intl_20251109105212_0877",
  "qwen3-coder-plus": "sfm_inferenceglobal_public_intl_20251109105213_0878"
};

const pricingDoc = `# Pricing

## Text generation

| Model         | Input per request | Input  | Output  |
| ------------- | ----------------- | ------ | ------- |
| qwen3.7-max   | 0 – 991K          | \\$2.50 | \\$7.50  |
| qwen3.7-plus  | ≤ 256K            | \\$0.40 | \\$1.60  |
|               | 256K – 1M         | \\$1.20 | \\$4.80  |

## Understanding

| Model         | Input per request | Input  | Output |
| ------------- | ----------------- | ------ | ------ |
| qwen3-vl-plus | ≤ 32K             | \\$0.20 | \\$1.60 |

**Image generation**

| Model        | Price per image |
| ------------ | --------------- |
| wan2.7-image | \\$0.03          |

## Embedding & reranking

| Model             | Modality | Price per 1M tokens |
| ----------------- | -------- | ------------------- |
| text-embedding-v4 | Text     | \\$0.07              |
`;

const personalDoc = `# Token Plan Individual

## Supported models

| Brand      | Model ID            | Capability                                       |
| ---------- | ------------------- | ------------------------------------------------ |
| Qwen       | qwen3.8-max-preview | Reasoning, visual understanding, text generation |
| Qwen       | qwen3.7-max         | Reasoning, text generation                       |
| Zhipu AI   | glm-5.2             | Reasoning, text generation                       |
| Wan        | wan2.7-image        | Image generation                                 |
| HappyHorse | happyhorse-1.1-t2v  | Video generation                                 |

## Supported Harness tools

| Capability | Tool name   |
| ---------- | ----------- |
| Web search | web\\_search |
`;

const teamDoc = `# Token Plan Team Edition

## Supported models

| Brand       | Model          | Capability                                       |
| ----------- | -------------- | ------------------------------------------------ |
| Qwen        | qwen3.7-max    | Reasoning, text generation                       |
| Moonshot AI | kimi-k2.7-code | Reasoning, vision understanding, text generation |
| Zhipu AI    | glm-5.2        | Reasoning, text generation                       |
`;

type RouteBody = { status?: number; body: string };

function createContext(routes: Record<string, RouteBody>, onRequest?: (url: string) => void): CollectorContext {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    onRequest?.(url);
    const route = routes[url];
    if (!route) {
      return new Response("not found", { status: 404 });
    }

    return new Response(route.body, {
      status: route.status ?? 200,
      headers: { "content-type": "text/plain" }
    });
  };

  return {
    now: new Date("2026-07-25T00:00:00.000Z"),
    fetch: fakeFetch,
    env: {}
  };
}

function marketplaceRoutes(overrides: Partial<Record<string, RouteBody>> = {}): Record<string, RouteBody> {
  return {
    [MODEL_MAPPING_URL]: { body: JSON.stringify(modelMapping) },
    [PRICING_DOC_URL]: { body: pricingDoc },
    ...overrides
  };
}

function tokenPlanRoutes(overrides: Partial<Record<string, RouteBody>> = {}): Record<string, RouteBody> {
  return {
    [TOKEN_PLAN_PERSONAL_DOC_URL]: { body: personalDoc },
    [TOKEN_PLAN_TEAM_DOC_URL]: { body: teamDoc },
    ...overrides
  };
}

describe("parseTokenRates", () => {
  it("keeps the lowest tier as the headline rate and records its band", () => {
    const rates = parseTokenRates(pricingDoc);

    expect(rates.get("qwen3.7-plus")).toEqual({ input: 0.4, output: 1.6, tierBasis: "≤ 256K" });
  });

  it("reads a single-rate table as input-only pricing", () => {
    expect(parseTokenRates(pricingDoc).get("text-embedding-v4")).toEqual({
      input: 0.07,
      output: null,
      tierBasis: null
    });
  });

  it("ignores tables billed in units other than tokens", () => {
    expect(parseTokenRates(pricingDoc).has("wan2.7-image")).toBe(false);
  });
});

describe("parseTokenPlanRoster", () => {
  it("reads the allowlist table and ignores the Harness tool table", () => {
    expect(parseTokenPlanRoster(personalDoc).map((entry) => entry.modelId)).toEqual([
      "qwen3.8-max-preview",
      "qwen3.7-max",
      "glm-5.2",
      "wan2.7-image",
      "happyhorse-1.1-t2v"
    ]);
  });

  it("accepts the Team table's `Model` header as well as `Model ID`", () => {
    expect(parseTokenPlanRoster(teamDoc).map((entry) => entry.modelId)).toEqual([
      "qwen3.7-max",
      "kimi-k2.7-code",
      "glm-5.2"
    ]);
  });
});

describe("qwencloudCollector", () => {
  it("requests the CDN model mapping and the pay-as-you-go pricing doc", async () => {
    const requested: string[] = [];
    await qwencloudCollector.collect(createContext(marketplaceRoutes(), (url) => requested.push(url)));

    expect(requested.sort()).toEqual([MODEL_MAPPING_URL, PRICING_DOC_URL].sort());
  });

  it("emits one offering per mapping entry with the documented rate", async () => {
    const result = await qwencloudCollector.collect(createContext(marketplaceRoutes()));

    expect(result.provider.id).toBe("qwencloud");
    expect(result.models).toHaveLength(Object.keys(modelMapping).length);
    expect(result.notices).toEqual([]);

    const max = result.models.find((model) => model.id === "qwencloud:qwen3.7-max");
    expect(max?.pricing).toMatchObject({
      kind: "paid",
      input_usd_per_1m_tokens: 2.5,
      output_usd_per_1m_tokens: 7.5,
      currency: "USD",
      metering: "tokens"
    });
    expect(max?.endpoint).toMatchObject({
      protocol: "openai_chat_completions",
      base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.7-max"
    });
    expect(max?.capabilities).toEqual(expect.arrayContaining(["chat", "streaming"]));
  });

  it("leaves an undocumented model's pricing unknown for the models.dev gap-fill", async () => {
    const result = await qwencloudCollector.collect(createContext(marketplaceRoutes()));
    const coder = result.models.find((model) => model.id === "qwencloud:qwen3-coder-plus");

    expect(coder?.pricing.kind).toBe("unknown");
    expect(coder?.pricing.input_usd_per_1m_tokens).toBeNull();
    expect(coder?.capabilities).toContain("coding");
    expect(coder?.source_claims).toHaveLength(1);
  });

  it("classifies non-text modalities by metering, protocol, and tag", async () => {
    const result = await qwencloudCollector.collect(createContext(marketplaceRoutes()));
    const byId = new Map(result.models.map((model) => [model.id, model]));

    expect(byId.get("qwencloud:wan2.7-image")?.pricing).toMatchObject({
      // Billed per image, so the per-1M-token fields stay null while the kind stays honest.
      kind: "paid",
      metering: "images",
      input_usd_per_1m_tokens: null,
      output_usd_per_1m_tokens: null
    });
    expect(byId.get("qwencloud:wan2.7-image")?.capabilities).toEqual(["image_generation"]);
    expect(byId.get("qwencloud:happyhorse-1.1-t2v")?.pricing.metering).toBe("video_seconds");
    expect(byId.get("qwencloud:happyhorse-1.1-t2v")?.policy.tags).toContain("video-generation");
    expect(byId.get("qwencloud:qwen3-asr-flash")?.capabilities).toEqual(["speech_to_text"]);
    expect(byId.get("qwencloud:qwen3-tts-flash")?.capabilities).toEqual(["text_to_speech"]);
    expect(byId.get("qwencloud:text-embedding-v4")?.capabilities).toEqual(["embeddings"]);
    expect(byId.get("qwencloud:qwen3-vl-plus")?.capabilities).toContain("vision");
    expect(byId.get("qwencloud:wan2.7-image")?.endpoint).toMatchObject({ protocol: "unknown", base_url: null });
  });

  it("keeps the roster and reports a notice when the pricing doc is unavailable", async () => {
    const result = await qwencloudCollector.collect(
      createContext(marketplaceRoutes({ [PRICING_DOC_URL]: { status: 500, body: "boom" } }))
    );

    expect(result.models).toHaveLength(Object.keys(modelMapping).length);
    expect(result.models.every((model) => model.pricing.input_usd_per_1m_tokens === null)).toBe(true);
    expect(result.models.find((model) => model.id === "qwencloud:qwen3.7-max")?.pricing.kind).toBe("unknown");
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "qwencloud",
        message: "pricing document unavailable; rates left unknown",
        status: 500
      })
    ]);
  });

  it("reports a notice when the mapping request fails", async () => {
    const result = await qwencloudCollector.collect(
      createContext(marketplaceRoutes({ [MODEL_MAPPING_URL]: { status: 503, body: "down" } }))
    );

    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "qwencloud", message: "collector unavailable", status: 503 })
    ]);
  });
});

describe("qwencloudTokenPlanCollector", () => {
  it("requests both edition rosters", async () => {
    const requested: string[] = [];
    await qwencloudTokenPlanCollector.collect(createContext(tokenPlanRoutes(), (url) => requested.push(url)));

    expect(requested.sort()).toEqual([TOKEN_PLAN_PERSONAL_DOC_URL, TOKEN_PLAN_TEAM_DOC_URL].sort());
  });

  it("unions both rosters and records which editions include each model", async () => {
    const result = await qwencloudTokenPlanCollector.collect(createContext(tokenPlanRoutes()));
    const byId = new Map(result.models.map((model) => [model.provider_model_id, model]));

    expect([...byId.keys()]).toEqual([
      "qwen3.8-max-preview",
      "qwen3.7-max",
      "glm-5.2",
      "wan2.7-image",
      "happyhorse-1.1-t2v",
      "kimi-k2.7-code"
    ]);
    expect(byId.get("qwen3.8-max-preview")?.pricing.subscription).toMatchObject({ plan_editions: ["personal"] });
    expect(byId.get("kimi-k2.7-code")?.pricing.subscription).toMatchObject({ plan_editions: ["team"] });
    expect(byId.get("qwen3.7-max")?.pricing.subscription).toMatchObject({ plan_editions: ["personal", "team"] });
    expect(byId.get("qwen3.7-max")?.policy.tags).toEqual(
      expect.arrayContaining(["token-plan", "token-plan-personal", "token-plan-team"])
    );
    expect(byId.get("qwen3.7-max")?.source_claims).toHaveLength(2);
  });

  it("prices every offering as a Credits-metered subscription with no per-token rate", async () => {
    const result = await qwencloudTokenPlanCollector.collect(createContext(tokenPlanRoutes()));

    for (const model of result.models) {
      expect(model.pricing.kind).toBe("subscription_included");
      expect(model.pricing.input_usd_per_1m_tokens).toBeNull();
      expect(model.pricing.output_usd_per_1m_tokens).toBeNull();
      expect(model.pricing.metering).toBe("credits");
      expect(model.pricing.subscription).toMatchObject({
        billing: "flat_monthly",
        per_token_billed: false,
        reference_pricing: false,
        credits_metered: true
      });
    }
  });

  it("derives capabilities from the roster capability column", async () => {
    const result = await qwencloudTokenPlanCollector.collect(createContext(tokenPlanRoutes()));
    const byId = new Map(result.models.map((model) => [model.provider_model_id, model]));

    expect(byId.get("qwen3.8-max-preview")?.capabilities).toEqual(
      expect.arrayContaining(["chat", "streaming", "reasoning", "vision"])
    );
    expect(byId.get("glm-5.2")?.capabilities).not.toContain("vision");
    expect(byId.get("wan2.7-image")?.capabilities).toEqual(["image_generation"]);
    expect(byId.get("kimi-k2.7-code")?.capabilities).toContain("coding");
  });

  it("keeps the reachable roster and reports a notice when one edition doc fails", async () => {
    const result = await qwencloudTokenPlanCollector.collect(
      createContext(tokenPlanRoutes({ [TOKEN_PLAN_TEAM_DOC_URL]: { status: 404, body: "gone" } }))
    );

    expect(result.models.map((model) => model.provider_model_id)).toEqual([
      "qwen3.8-max-preview",
      "qwen3.7-max",
      "glm-5.2",
      "wan2.7-image",
      "happyhorse-1.1-t2v"
    ]);
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "qwencloud-token-plan",
        message: "team roster unavailable",
        status: 404
      })
    ]);
  });

  it("reports a notice when both edition docs fail", async () => {
    const result = await qwencloudTokenPlanCollector.collect(
      createContext(
        tokenPlanRoutes({
          [TOKEN_PLAN_PERSONAL_DOC_URL]: { status: 500, body: "boom" },
          [TOKEN_PLAN_TEAM_DOC_URL]: { status: 500, body: "boom" }
        })
      )
    );

    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "qwencloud-token-plan", message: "collector unavailable" })
    ]);
  });
});
