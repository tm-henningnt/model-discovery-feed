import { describe, expect, it } from "vitest";
import { clineCollector, clinePassCollector } from "./cline";
import type { CollectorContext } from "./types";

const CATALOG_URL = "https://api.cline.bot/api/v1/ai/cline/models";

const catalogResponse = {
  data: [
    {
      id: "z-ai/glm-5.2",
      canonical_slug: "z-ai/glm-5.2-20260601",
      name: "Z.ai: GLM 5.2",
      description: "Best open weights model",
      context_length: 1048576,
      pricing: { prompt: "0.00000042", completion: "0.00000132" },
      top_provider: { max_completion_tokens: 131072 },
      supported_parameters: ["tools", "reasoning", "response_format"],
      architecture: { input_modalities: ["text"], output_modalities: ["text"] }
    },
    {
      id: "moonshotai/kimi-k2.7-code",
      name: "MoonshotAI: Kimi K2.7 Code",
      context_length: 262144,
      pricing: { prompt: "0.00000072", completion: "0.0000035" },
      top_provider: { max_completion_tokens: 262144 },
      supported_parameters: ["tools"],
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }
    },
    {
      id: "tencent/hy3:free",
      name: "Tencent: HY3 (free)",
      context_length: 200000,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools"],
      architecture: { input_modalities: ["text"], output_modalities: ["text"] }
    }
  ]
};

const recommendedResponse = {
  recommended: [{ id: "openai/gpt-5.6-sol", name: "gpt-5.6-sol", tags: ["NEW"] }],
  free: [{ id: "tencent/hy3:free", name: "hy3" }],
  clinePass: [
    { id: "cline-pass/glm-5.2", name: "cline-pass/glm-5.2", description: "Best open weights model", tags: [] },
    { id: "cline-pass/kimi-k2.7-code", name: "cline-pass/kimi-k2.7-code", description: "Coding specialist", tags: [] },
    { id: "cline-pass/ghost-model", name: "cline-pass/ghost-model", description: "Not in catalog", tags: [] }
  ]
};

type Bodies = { catalog?: unknown; recommended?: unknown };
type Failures = { catalog?: number; recommended?: number };

function createContext(overrides: {
  env?: Record<string, string | undefined>;
  onRequest?: (url: string, init: RequestInit | undefined) => void;
  bodies?: Bodies;
  failures?: Failures;
}): CollectorContext {
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    overrides.onRequest?.(url, init);
    const isCatalog = url === CATALOG_URL;
    const failStatus = isCatalog ? overrides.failures?.catalog : overrides.failures?.recommended;
    if (failStatus) {
      return new Response(JSON.stringify({ error: "boom" }), { status: failStatus });
    }
    const body = isCatalog
      ? overrides.bodies?.catalog ?? catalogResponse
      : overrides.bodies?.recommended ?? recommendedResponse;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };

  return {
    now: new Date("2026-07-13T00:00:00.000Z"),
    fetch: fakeFetch,
    env: overrides.env ?? {}
  };
}

describe("clineCollector", () => {
  it("normalizes the OpenRouter-shaped catalog into cline offerings", async () => {
    const result = await clineCollector.collect(createContext({}));

    expect(result.provider.id).toBe("cline");
    expect(result.models.map((m) => m.id)).toEqual([
      "cline:z-ai/glm-5.2",
      "cline:moonshotai/kimi-k2.7-code",
      "cline:tencent/hy3:free"
    ]);
    expect(result.notices).toEqual([]);
  });

  it("assigns high-confidence canonical IDs with the variant suffix stripped", async () => {
    const result = await clineCollector.collect(createContext({}));

    const free = result.models.find((m) => m.id === "cline:tencent/hy3:free");
    // `:free` variant suffix stripped for the canonical join key (ADR 0003).
    expect(free?.canonical_model?.id).toBe("tencent/hy3");
    expect(free?.canonical_model?.confidence).toBe("high");
  });

  it("derives pricing kind and capabilities from the catalog payload", async () => {
    const result = await clineCollector.collect(createContext({}));

    const glm = result.models.find((m) => m.id === "cline:z-ai/glm-5.2");
    expect(glm?.pricing.kind).toBe("paid");
    expect(glm?.pricing.input_usd_per_1m_tokens).toBeCloseTo(0.42, 6);
    expect(glm?.pricing.output_usd_per_1m_tokens).toBeCloseTo(1.32, 6);
    expect(glm?.capabilities).toEqual(expect.arrayContaining(["tool_use", "structured_output", "reasoning"]));

    const kimi = result.models.find((m) => m.id === "cline:moonshotai/kimi-k2.7-code");
    expect(kimi?.capabilities).toEqual(expect.arrayContaining(["vision"]));
    // ADR 0009: the `coding` capability is no longer inferred here. It moved to the
    // derive-coding-capability pipeline stage — see derive-coding-capability.test.ts.
    expect(kimi?.capabilities).not.toContain("coding");

    const free = result.models.find((m) => m.id === "cline:tencent/hy3:free");
    expect(free?.pricing.kind).toBe("free");
    expect(free?.pricing.free?.is_currently_free).toBe(true);
    expect(free?.policy.tags).toContain("free");
  });

  it("sends the CLINE_API_KEY as a bearer token when present", async () => {
    let authorization: string | null = null;
    await clineCollector.collect(
      createContext({
        env: { CLINE_API_KEY: "cline_test_key" },
        onRequest: (url, init) => {
          if (url === CATALOG_URL) authorization = new Headers(init?.headers).get("authorization");
        }
      })
    );
    expect(authorization).toBe("Bearer cline_test_key");
  });

  it("reports a notice when the catalog request fails", async () => {
    const result = await clineCollector.collect(createContext({ failures: { catalog: 503 } }));
    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "cline", message: "collector unavailable", status: 503 })
    ]);
  });

  it("emits response_envelope_key in protocol_options for every offering", async () => {
    const result = await clineCollector.collect(createContext({}));

    result.models.forEach((model) => {
      expect(model.endpoint.protocol_options).toBeDefined();
      expect(model.endpoint.protocol_options?.response_envelope_key).toBe("data");
    });
  });
});

describe("clinePassCollector", () => {
  it("builds subscription offerings from the clinePass roster joined to the catalog", async () => {
    const result = await clinePassCollector.collect(createContext({}));

    expect(result.provider.id).toBe("cline-pass");
    expect(result.models.map((m) => m.id)).toEqual([
      "cline-pass:cline-pass/glm-5.2",
      "cline-pass:cline-pass/kimi-k2.7-code",
      "cline-pass:cline-pass/ghost-model"
    ]);
    expect(result.notices).toEqual([]);
  });

  it("enriches a matched model with catalog metadata, reference pricing, and a high-confidence canonical ID", async () => {
    const result = await clinePassCollector.collect(createContext({}));
    const glm = result.models.find((m) => m.id === "cline-pass:cline-pass/glm-5.2");

    expect(glm?.display_name).toBe("Z.ai: GLM 5.2");
    expect(glm?.canonical_model?.id).toBe("z-ai/glm-5.2");
    expect(glm?.canonical_model?.confidence).toBe("high");
    expect(glm?.limits.context_tokens).toBe(1048576);
    expect(glm?.pricing.kind).toBe("subscription_included");
    // Reference rate = the underlying model's live pay-as-you-go price, a cheap/expensive signal only.
    expect(glm?.pricing.input_usd_per_1m_tokens).toBeCloseTo(0.42, 6);
    expect(glm?.pricing.output_usd_per_1m_tokens).toBeCloseTo(1.32, 6);
    expect(glm?.pricing.subscription).toMatchObject({
      billing: "flat_monthly",
      per_token_billed: false,
      quota_multiplier_vs_payg: "2-5x"
    });
    expect(glm?.quality.recommendation_notes).toContain("Best open weights model");
  });

  it("falls back to roster-only fields and a medium-confidence canonical ID when the slug is not in the catalog", async () => {
    const result = await clinePassCollector.collect(createContext({}));
    const ghost = result.models.find((m) => m.id === "cline-pass:cline-pass/ghost-model");

    expect(ghost?.display_name).toBe("ghost-model");
    expect(ghost?.canonical_model?.id).toBe("cline-pass/ghost-model");
    expect(ghost?.canonical_model?.confidence).toBe("medium");
    expect(ghost?.limits.context_tokens).toBeNull();
    expect(ghost?.pricing.kind).toBe("subscription_included");
    expect(ghost?.pricing.input_usd_per_1m_tokens).toBeNull();
  });

  it("emits a notice but still lists the roster when the catalog join is unavailable", async () => {
    const result = await clinePassCollector.collect(createContext({ failures: { catalog: 500 } }));

    expect(result.models).toHaveLength(3);
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "cline-pass", message: expect.stringContaining("catalog join unavailable") })
    ]);
    const glm = result.models.find((m) => m.id === "cline-pass:cline-pass/glm-5.2");
    // No catalog to join → roster-only, so pricing rates and context are null and canonical is medium.
    expect(glm?.canonical_model?.confidence).toBe("medium");
    expect(glm?.limits.context_tokens).toBeNull();
    expect(glm?.pricing.kind).toBe("subscription_included");
  });

  it("reports collector unavailable when the roster endpoint fails", async () => {
    const result = await clinePassCollector.collect(createContext({ failures: { recommended: 502 } }));
    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "cline-pass", message: "collector unavailable", status: 502 })
    ]);
  });

  it("returns no models (no crash) for an empty clinePass roster", async () => {
    const result = await clinePassCollector.collect(
      createContext({ bodies: { recommended: { clinePass: [] } } })
    );
    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([]);
  });

  it("emits response_envelope_key in protocol_options for every offering", async () => {
    const result = await clinePassCollector.collect(createContext({}));

    result.models.forEach((model) => {
      expect(model.endpoint.protocol_options).toBeDefined();
      expect(model.endpoint.protocol_options?.response_envelope_key).toBe("data");
    });
  });
});

describe("clinePassCollector catalog-join matcher", () => {
  const onlyGlm = { recommended: [], free: [], clinePass: [{ id: "cline-pass/glm-5.2", name: "cline-pass/glm-5.2" }] };

  function pass(catalog: unknown) {
    return clinePassCollector.collect(createContext({ bodies: { recommended: onlyGlm, catalog } }));
  }

  it("prefers the paid entry over a `:free` sibling so the reference rate is not zeroed", async () => {
    // `:free` sibling listed first — first-wins would incorrectly bind the 0/0 rate.
    const result = await pass({
      data: [
        { id: "z-ai/glm-5.2:free", name: "Z.ai: GLM 5.2 (free)", context_length: 1048576, pricing: { prompt: "0", completion: "0" } },
        { id: "z-ai/glm-5.2", name: "Z.ai: GLM 5.2", context_length: 1048576, pricing: { prompt: "0.00000042", completion: "0.00000132" } }
      ]
    });
    const glm = result.models[0];
    expect(glm.canonical_model?.id).toBe("z-ai/glm-5.2");
    expect(glm.canonical_model?.confidence).toBe("high");
    expect(glm.pricing.input_usd_per_1m_tokens).toBeCloseTo(0.42, 6);
    expect(glm.pricing.output_usd_per_1m_tokens).toBeCloseTo(1.32, 6);
  });

  it("refuses an ambiguous join when two distinct creators share the model segment", async () => {
    const result = await pass({
      data: [
        { id: "x-ai/glm-5.2", name: "xAI GLM", context_length: 100, pricing: { prompt: "0.001", completion: "0.002" } },
        { id: "z-ai/glm-5.2", name: "Z.ai GLM", context_length: 200, pricing: { prompt: "0.003", completion: "0.004" } }
      ]
    });
    const glm = result.models[0];
    // Neither is bound at high confidence — degrade to a medium echo rather than a wrong join.
    expect(glm.canonical_model?.confidence).toBe("medium");
    expect(glm.canonical_model?.id).toBe("cline-pass/glm-5.2");
    expect(glm.pricing.input_usd_per_1m_tokens).toBeNull();
    expect(glm.limits.context_tokens).toBeNull();
  });

  it("does not treat a near-miss segment as a match", async () => {
    const result = await pass({
      data: [{ id: "openai/x-glm-5.2", name: "Not it", context_length: 100, pricing: { prompt: "0.1", completion: "0.2" } }]
    });
    const glm = result.models[0];
    expect(glm.canonical_model?.confidence).toBe("medium");
    expect(glm.pricing.input_usd_per_1m_tokens).toBeNull();
  });

  it("matches case-insensitively", async () => {
    const result = await clinePassCollector.collect(
      createContext({
        bodies: {
          recommended: { clinePass: [{ id: "cline-pass/GLM-5.2", name: "cline-pass/GLM-5.2" }] },
          catalog: { data: [{ id: "z-ai/glm-5.2", name: "Z.ai: GLM 5.2", context_length: 1048576, pricing: { prompt: "0.00000042", completion: "0.00000132" } }] }
        }
      })
    );
    const glm = result.models[0];
    expect(glm.display_name).toBe("Z.ai: GLM 5.2");
    expect(glm.canonical_model?.confidence).toBe("high");
  });
});
