import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { ModelOffering } from "../feed/schema";
import type { ModelsDevResponse } from "./models-dev";
import { applyModelsDevDeprecation } from "./models-dev-deprecation";

const OBSERVED_AT = "2026-07-11T12:00:00.000Z";

function offering(overrides: Partial<ModelOffering> & { id: string; providerId: string; providerModelId: string }): ModelOffering {
  const base = structuredClone(exampleFeed.models[0]);
  const { providerId, providerModelId, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    id: overrides.id,
    provider: { id: providerId, name: providerId },
    provider_model_id: providerModelId,
    availability: { ...base.availability, ...rest.availability },
    canonical_model: rest.canonical_model !== undefined ? rest.canonical_model : base.canonical_model
  };
}

const catalog = {
  openrouter: {
    models: {
      "mistralai/devstral-2512": { id: "mistralai/devstral-2512", name: "Devstral 2512", status: "deprecated" },
      "openai/gpt-5.6-luna": { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" }
    }
  }
} satisfies ModelsDevResponse;

describe("applyModelsDevDeprecation", () => {
  it("marks a confidently-canonical offering deprecated when models.dev status says so", () => {
    const model = offering({
      id: "openrouter:mistralai/devstral-2512",
      providerId: "openrouter",
      providerModelId: "mistralai/devstral-2512",
      canonical_model: { id: "mistralai/devstral-2512", confidence: "high", knowledge_cutoff: null, release_date: null, open_weights: null }
    });

    const result = applyModelsDevDeprecation([model], catalog, OBSERVED_AT);

    const updated = result.models.find((m) => m.id === model.id);
    expect(updated?.availability.status).toBe("deprecated");
    expect(updated?.source_claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collector: "models-dev-deprecation",
          source_type: "third_party_catalog",
          field_paths: ["availability.status"],
          raw_reference: expect.objectContaining({ rule: "models_dev_deprecated" })
        })
      ])
    );
    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: "models-dev-deprecation",
        message: "marked offerings deprecated from models.dev status",
        deprecated_count: 1
      })
    ]);
  });

  it("does not change status when the canonical match is not confident, even though models.dev marks the id deprecated", () => {
    const model = offering({
      id: "openrouter:mistralai/devstral-2512",
      providerId: "openrouter",
      providerModelId: "mistralai/devstral-2512",
      canonical_model: { id: "mistralai/devstral-2512", confidence: "medium", knowledge_cutoff: null, release_date: null, open_weights: null }
    });

    const result = applyModelsDevDeprecation([model], catalog, OBSERVED_AT);

    const updated = result.models.find((m) => m.id === model.id);
    expect(updated?.availability.status).toBe("available");
    expect(updated).toEqual(model);
    expect(result.notices).toEqual([]);
  });

  it("leaves a non-available status untouched — first-party evidence (e.g. an expiration date) outranks models.dev", () => {
    const model = offering({
      id: "openrouter:mistralai/devstral-2512",
      providerId: "openrouter",
      providerModelId: "mistralai/devstral-2512",
      availability: { status: "retired", last_checked_at: OBSERVED_AT, last_success_at: OBSERVED_AT, stale_after_seconds: 86400 },
      canonical_model: { id: "mistralai/devstral-2512", confidence: "high", knowledge_cutoff: null, release_date: null, open_weights: null }
    });

    const result = applyModelsDevDeprecation([model], catalog, OBSERVED_AT);

    const updated = result.models.find((m) => m.id === model.id);
    expect(updated?.availability.status).toBe("retired");
    expect(result.notices).toEqual([]);
  });

  it("leaves an offering unchanged when models.dev has no entry or no deprecated status for it", () => {
    const model = offering({
      id: "openrouter:openai/gpt-5.6-luna",
      providerId: "openrouter",
      providerModelId: "openai/gpt-5.6-luna",
      canonical_model: { id: "openai/gpt-5.6-luna", confidence: "high", knowledge_cutoff: null, release_date: null, open_weights: null }
    });

    const result = applyModelsDevDeprecation([model], catalog, OBSERVED_AT);

    expect(result.models).toEqual([model]);
    expect(result.notices).toEqual([]);
  });

  it("does nothing and emits no notices when the catalog is null", () => {
    const model = offering({
      id: "openrouter:mistralai/devstral-2512",
      providerId: "openrouter",
      providerModelId: "mistralai/devstral-2512",
      canonical_model: { id: "mistralai/devstral-2512", confidence: "high", knowledge_cutoff: null, release_date: null, open_weights: null }
    });

    const result = applyModelsDevDeprecation([model], null, OBSERVED_AT);

    expect(result.models).toEqual([model]);
    expect(result.notices).toEqual([]);
  });
});
