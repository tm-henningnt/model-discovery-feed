import { describe, expect, it, vi } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { ModelOffering } from "../feed/schema";

function offering(index: number): ModelOffering {
  return structuredClone(exampleFeed.models[index]);
}

function unmatchedGroqOffering(): ModelOffering {
  const unmatched = offering(0);
  unmatched.id = "groq:unmatched-model";
  unmatched.provider = { id: "groq", name: "Groq" };
  unmatched.provider_model_id = "unmatched-model";
  unmatched.canonical_model = {
    id: "unmatched-model",
    confidence: "medium",
    knowledge_cutoff: null,
    release_date: null,
    open_weights: null
  };
  unmatched.endpoint = { ...unmatched.endpoint, model: "unmatched-model" };
  return unmatched;
}

function openrouterOffering(providerModelId: string): ModelOffering {
  const model = offering(0);
  model.id = `openrouter:${providerModelId}`;
  model.provider = { id: "openrouter", name: "OpenRouter" };
  model.provider_model_id = providerModelId;
  model.canonical_model = {
    id: providerModelId,
    confidence: "high",
    knowledge_cutoff: null,
    release_date: null,
    open_weights: null
  };
  model.endpoint = { ...model.endpoint, model: providerModelId };
  return model;
}

describe("canonicalize", () => {
  it("uses a curated alias and marks the canonical identity high confidence", async () => {
    const { canonicalize } = await import("./canonicalize");
    const groqOffering = offering(1);
    groqOffering.canonical_model = {
      ...groqOffering.canonical_model!,
      id: "openai/gpt-oss-120b",
      confidence: "medium"
    };

    const result = canonicalize([groqOffering]);

    expect(result.models[0].canonical_model).toMatchObject({
      id: "openai/gpt-oss-120b",
      confidence: "high"
    });
  });

  it("leaves an unmatched provider echo at medium confidence", async () => {
    const { canonicalize } = await import("./canonicalize");
    const unmatched = unmatchedGroqOffering();

    expect(canonicalize([unmatched]).models).toEqual([unmatched]);
  });

  it("strips an OpenRouter variant suffix from the canonical id", async () => {
    const { canonicalize } = await import("./canonicalize");
    const freeVariant = offering(0);
    freeVariant.id = "openrouter:qwen/qwen3-coder:free";
    freeVariant.provider = { id: "openrouter", name: "OpenRouter" };
    freeVariant.provider_model_id = "qwen/qwen3-coder:free";
    freeVariant.canonical_model = {
      id: "qwen/qwen3-coder:free",
      confidence: "high",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    };
    freeVariant.endpoint = { ...freeVariant.endpoint, model: "qwen/qwen3-coder:free" };

    expect(canonicalize([freeVariant]).models[0]?.canonical_model?.id).toBe("qwen/qwen3-coder");
  });

  it("is idempotent", async () => {
    const { canonicalize } = await import("./canonicalize");
    const models = [offering(0), offering(1), unmatchedGroqOffering()];

    const once = canonicalize(models).models;
    const twice = canonicalize(once).models;
    expect(twice).toEqual(once);
  });

  it("resolves opencode-go:kimi-k2.7-code to moonshotai/kimi-k2.7-code at high confidence", async () => {
    const { canonicalize } = await import("./canonicalize");
    const opencodeGo = offering(1);
    opencodeGo.id = "opencode-go:kimi-k2.7-code";
    opencodeGo.provider = { id: "opencode-go", name: "OpenCode Go" };
    opencodeGo.provider_model_id = "kimi-k2.7-code";
    opencodeGo.canonical_model = {
      id: "kimi-k2.7-code",
      confidence: "medium",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    };
    opencodeGo.endpoint = { ...opencodeGo.endpoint, model: "kimi-k2.7-code" };

    const result = canonicalize([opencodeGo]);

    expect(result.models[0].canonical_model).toMatchObject({
      id: "moonshotai/kimi-k2.7-code",
      confidence: "high"
    });
  });

  it("resolves opencode-zen:deepseek-v4-flash-free to deepseek/deepseek-v4-flash at high confidence", async () => {
    const { canonicalize } = await import("./canonicalize");
    const opencodeZen = offering(1);
    opencodeZen.id = "opencode-zen:deepseek-v4-flash-free";
    opencodeZen.provider = { id: "opencode-zen", name: "OpenCode Zen" };
    opencodeZen.provider_model_id = "deepseek-v4-flash-free";
    opencodeZen.canonical_model = {
      id: "deepseek-v4-flash-free",
      confidence: "medium",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    };
    opencodeZen.endpoint = { ...opencodeZen.endpoint, model: "deepseek-v4-flash-free" };

    const result = canonicalize([opencodeZen]);

    expect(result.models[0].canonical_model).toMatchObject({
      id: "deepseek/deepseek-v4-flash",
      confidence: "high"
    });
  });

  describe("QwenCloud segment join", () => {
    function qwencloudOffering(providerId: string, providerModelId: string): ModelOffering {
      const model = offering(1);
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

    it("binds a bare model id to the one live OpenRouter slug sharing its segment", async () => {
      const { canonicalize } = await import("./canonicalize");
      const live = openrouterOffering("z-ai/glm-5.2");
      const qwencloud = qwencloudOffering("qwencloud", "glm-5.2");
      const tokenPlan = qwencloudOffering("qwencloud-token-plan", "glm-5.2");

      const result = canonicalize([live, qwencloud, tokenPlan]);

      expect(result.models[1].canonical_model).toMatchObject({ id: "z-ai/glm-5.2", confidence: "high" });
      expect(result.models[2].canonical_model).toMatchObject({ id: "z-ai/glm-5.2", confidence: "high" });
    });

    it("matches case-insensitively", async () => {
      const { canonicalize } = await import("./canonicalize");
      const live = openrouterOffering("minimax/minimax-m2.5");
      const tokenPlan = qwencloudOffering("qwencloud-token-plan", "MiniMax-M2.5");

      expect(canonicalize([live, tokenPlan]).models[1].canonical_model).toMatchObject({
        id: "minimax/minimax-m2.5",
        confidence: "high"
      });
    });

    it("refuses an ambiguous segment and reports it", async () => {
      const { canonicalize } = await import("./canonicalize");
      const first = openrouterOffering("creator-a/shared-model");
      const second = openrouterOffering("creator-b/shared-model");
      const qwencloud = qwencloudOffering("qwencloud", "shared-model");

      const result = canonicalize([first, second, qwencloud]);

      expect(result.models[2].canonical_model).toMatchObject({ id: "shared-model", confidence: "medium" });
      expect(
        result.notices.filter((notice) => notice.message === "model segment matched more than one OpenRouter creator")
      ).toEqual([
        expect.objectContaining({
          collector: "canonicalize",
          ambiguous_offerings: [
            { offering_id: "qwencloud:shared-model", candidates: ["creator-a/shared-model", "creator-b/shared-model"] }
          ]
        })
      ]);
    });

    it("leaves a QwenCloud-only model at its medium-confidence echo", async () => {
      const { canonicalize } = await import("./canonicalize");
      const live = openrouterOffering("z-ai/glm-5.2");
      const qwencloud = qwencloudOffering("qwencloud", "qwen-vl-ocr");

      const result = canonicalize([live, qwencloud]);

      expect(result.models[1]).toEqual(qwencloud);
      expect(
        result.notices.filter((notice) => notice.message === "model segment matched more than one OpenRouter creator")
      ).toEqual([]);
    });
  });

  describe("alias staleness notice", () => {
    it("emits one aggregated notice listing every alias target absent from the live OpenRouter catalog", async () => {
      vi.resetModules();
      vi.doMock("../feed/canonical-aliases", () => ({
        CANONICAL_ALIASES: {
          "groq:live-model": "openrouter/live-target",
          "groq:dead-model-a": "openrouter/delisted-a",
          "groq:dead-model-b": "openrouter/delisted-b"
        }
      }));
      const { canonicalize } = await import("./canonicalize");

      const liveOffering = openrouterOffering("openrouter/live-target");
      const groqOffering = offering(1);
      groqOffering.id = "groq:live-model";

      const result = canonicalize([liveOffering, groqOffering]);

      expect(result.notices).toEqual([
        expect.objectContaining({
          collector: "canonicalize",
          message: "alias targets not found in current OpenRouter catalog",
          stale_aliases: expect.arrayContaining([
            { key: "groq:dead-model-a", target: "openrouter/delisted-a" },
            { key: "groq:dead-model-b", target: "openrouter/delisted-b" }
          ])
        })
      ]);
      expect(result.notices[0].stale_aliases).toHaveLength(2);

      vi.doUnmock("../feed/canonical-aliases");
      vi.resetModules();
    });

    it("emits no notice when every alias target matches a live OpenRouter offering", async () => {
      vi.resetModules();
      vi.doMock("../feed/canonical-aliases", () => ({
        CANONICAL_ALIASES: {
          "groq:live-model": "openrouter/live-target"
        }
      }));
      const { canonicalize } = await import("./canonicalize");

      const liveOffering = openrouterOffering("openrouter/live-target");
      const groqOffering = offering(1);
      groqOffering.id = "groq:live-model";

      const result = canonicalize([liveOffering, groqOffering]);

      expect(result.notices).toEqual([]);

      vi.doUnmock("../feed/canonical-aliases");
      vi.resetModules();
    });
  });
});

