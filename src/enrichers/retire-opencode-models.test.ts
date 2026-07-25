import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { ModelOffering } from "../feed/schema";
import type { ModelsDevResponse } from "./models-dev";
import { retireOpencodeModels } from "./retire-opencode-models";

function offering(providerId: string, providerModelId: string): ModelOffering {
  const model = structuredClone(exampleFeed.models[1]);
  model.id = `${providerId}:${providerModelId}`;
  model.provider = { id: providerId, name: providerId };
  model.provider_model_id = providerModelId;
  return model;
}

const catalog = {
  "opencode-go": {
    models: {
      "glm-5": { id: "glm-5", name: "GLM 5", status: "deprecated" },
      "glm-5.2": { id: "glm-5.2", name: "GLM 5.2" }
      // "hy3-preview" is intentionally absent: models.dev never indexed it.
    }
  },
  opencode: {
    models: {
      "deepseek-v4-flash-free": { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free" }
    }
  },
  openrouter: {
    models: {
      "glm-5": { id: "glm-5", name: "GLM 5 (OpenRouter)", status: "deprecated" }
    }
  }
} satisfies ModelsDevResponse;

describe("retireOpencodeModels", () => {
  it("drops an opencode-go offering whose models.dev entry is status: deprecated", () => {
    const model = offering("opencode-go", "glm-5");
    const result = retireOpencodeModels([model], catalog);

    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "retire-opencode-models",
        message: "dropped models.dev-deprecated OpenCode offerings",
        offering_ids: ["opencode-go:glm-5"]
      })
    ]);
  });

  it("drops an opencode-go offering absent from models.dev and emits a loud absence notice naming the id", () => {
    const model = offering("opencode-go", "hy3-preview");
    const result = retireOpencodeModels([model], catalog);

    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "retire-opencode-models",
        message: expect.stringContaining("absent from models.dev"),
        offering_ids: ["opencode-go:hy3-preview"]
      })
    ]);
  });

  it("keeps an opencode-go offering present in models.dev with no status", () => {
    const model = offering("opencode-go", "glm-5.2");
    const result = retireOpencodeModels([model], catalog);

    expect(result.models).toEqual([model]);
    expect(result.notices).toEqual([]);
  });

  it("drops nothing and emits a notice when the catalog is null", () => {
    const model = offering("opencode-go", "glm-5");
    const result = retireOpencodeModels([model], null);

    expect(result.models).toEqual([model]);
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "retire-opencode-models",
        message: "models.dev catalog unavailable; dropped nothing"
      })
    ]);
  });

  it("never drops an offering from a provider other than opencode-go/opencode-zen, even if models.dev marks the same id deprecated elsewhere", () => {
    const model = offering("openrouter", "glm-5");
    const result = retireOpencodeModels([model], catalog);

    expect(result.models).toEqual([model]);
    expect(result.notices).toEqual([]);
  });

  it("matches opencode-zen offerings against the opencode models.dev provider, not opencode-go", () => {
    const kept = offering("opencode-zen", "deepseek-v4-flash-free");
    const dropped = offering("opencode-zen", "glm-5"); // exists under opencode-go, not opencode

    const result = retireOpencodeModels([kept, dropped], catalog);

    expect(result.models).toEqual([kept]);
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "retire-opencode-models",
        offering_ids: ["opencode-zen:glm-5"]
      })
    ]);
  });
});
