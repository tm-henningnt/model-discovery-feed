import { describe, expect, it } from "vitest";
import { applyAvailabilityLifecycle } from "../collectors/availability-lifecycle";
import type { CollectorContext } from "../collectors/types";
import type { FeedDocument } from "../feed/schema";
import { exampleFeed } from "../feed/fixture";
import { ARTIFICIAL_ANALYSIS_API_URL } from "./artificial-analysis";
import { MODELS_DEV_API_URL } from "./models-dev";
import { enrichModels } from "./pipeline";

const modelsDevPayload = {
  openrouter: {
    models: {
      // models.dev is matched by the offering's own provider_model_id
      // (including any OpenRouter variant suffix), not the canonicalized
      // cross-provider slug.
      "qwen/qwen3-coder:free": {
        id: "qwen/qwen3-coder:free",
        name: "Qwen3 Coder (free)",
        knowledge: "2025-01",
        release_date: "2025-06-17",
        open_weights: true
      }
    }
  }
};

const artificialAnalysisPayload = {
  status: "success",
  prompt_options: [],
  data: [
    {
      id: "aa-qwen3-coder",
      name: "qwen3-coder",
      model_creator: { id: "qwen", name: "Qwen", slug: "qwen" },
      evaluations: { artificial_analysis_intelligence_index: 51.2, artificial_analysis_coding_index: 71.4 }
    }
  ]
};

function context(): CollectorContext {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === MODELS_DEV_API_URL) {
      return new Response(JSON.stringify(modelsDevPayload), { status: 200 });
    }
    if (url === ARTIFICIAL_ANALYSIS_API_URL) {
      return new Response(JSON.stringify(artificialAnalysisPayload), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  return {
    now: new Date("2026-07-11T12:00:00.000Z"),
    fetch: fetchImpl,
    env: { ARTIFICIALANALYSIS_API_KEY: "aa_test_key" }
  };
}

describe("enrichModels", () => {
  it("runs all four stages and concatenates every sub-stage's notices", async () => {
    const models = structuredClone(exampleFeed.models);
    const result = await enrichModels(models, context());

    // The OpenRouter specimen canonicalizes to a real slug and gets scored by
    // the AA fixture payload above (via canonicalize -> models-dev -> AA).
    const openrouterModel = result.models.find((m) => m.id === "openrouter:qwen/qwen3-coder:free");
    expect(openrouterModel?.canonical_model?.confidence).toBe("high");
    expect(openrouterModel?.quality.coding_score).toBe(71.4);
    expect(openrouterModel?.canonical_model?.open_weights).toBe(true);

    // notices is the concatenation of models-dev + AA + propagation notices —
    // nothing here is dropped or duplicated.
    expect(Array.isArray(result.notices)).toBe(true);
    expect(result.artificialAnalysis.attemptedFetch).toBe(true);
    expect(result.artificialAnalysis.snapshotToPersist).toEqual(artificialAnalysisPayload);
  });

  it("is idempotent: running the pipeline twice on its own output changes nothing further", async () => {
    const models = structuredClone(exampleFeed.models);
    const once = await enrichModels(models, context());
    const twice = await enrichModels(once.models, context());

    expect(twice.models).toEqual(once.models);
  });

  it("passes fallbackSnapshot through to the Artificial Analysis stage untouched", async () => {
    const models = structuredClone(exampleFeed.models);
    const failingContext: CollectorContext = {
      now: new Date("2026-07-11T12:00:00.000Z"),
      fetch: async (input) => {
        const url = String(input);
        if (url === MODELS_DEV_API_URL) {
          return new Response(JSON.stringify(modelsDevPayload), { status: 200 });
        }
        return new Response("unavailable", { status: 503 });
      },
      env: { ARTIFICIALANALYSIS_API_KEY: "aa_test_key" }
    };

    const fallbackSnapshot = {
      id: "snapshot-1",
      observedAt: "2026-07-01T00:00:00.000Z",
      body: artificialAnalysisPayload
    };

    const result = await enrichModels(models, failingContext, { fallbackSnapshot });

    const openrouterModel = result.models.find((m) => m.id === "openrouter:qwen/qwen3-coder:free");
    expect(openrouterModel?.quality.coding_score).toBe(71.4);
    const claim = openrouterModel?.source_claims.find((c) => c.collector === "artificial-analysis");
    expect(claim?.observed_at).toBe("2026-07-01T00:00:00.000Z");
  });

  it("drops a retired OpenCode Go offering using models.dev status, while leaving every other enrichment result unchanged", async () => {
    const models = structuredClone(exampleFeed.models);
    const retiredOffering = structuredClone(models[1]);
    retiredOffering.id = "opencode-go:glm-5";
    retiredOffering.provider = { id: "opencode-go", name: "opencode-go" };
    retiredOffering.provider_model_id = "glm-5";
    models.push(retiredOffering);

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === MODELS_DEV_API_URL) {
        return new Response(
          JSON.stringify({
            ...modelsDevPayload,
            "opencode-go": {
              models: {
                "glm-5": { id: "glm-5", name: "GLM 5", status: "deprecated" }
              }
            }
          }),
          { status: 200 }
        );
      }
      if (url === ARTIFICIAL_ANALYSIS_API_URL) {
        return new Response(JSON.stringify(artificialAnalysisPayload), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await enrichModels(models, {
      now: new Date("2026-07-11T12:00:00.000Z"),
      fetch: fetchImpl,
      env: { ARTIFICIALANALYSIS_API_KEY: "aa_test_key" }
    });

    expect(result.models.find((m) => m.id === "opencode-go:glm-5")).toBeUndefined();
    expect(result.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collector: "retire-opencode-models",
          message: "dropped models.dev-deprecated OpenCode offerings",
          offering_ids: ["opencode-go:glm-5"]
        })
      ])
    );

    // The other enrichment results (models.dev + AA scoring on the untouched
    // OpenRouter offering) are unaffected by adding this new stage.
    const openrouterModel = result.models.find((m) => m.id === "openrouter:qwen/qwen3-coder:free");
    expect(openrouterModel?.canonical_model?.confidence).toBe("high");
    expect(openrouterModel?.quality.coding_score).toBe(71.4);
    expect(result.artificialAnalysis.attemptedFetch).toBe(true);
    expect(result.artificialAnalysis.snapshotToPersist).toEqual(artificialAnalysisPayload);
  });

  it("marks a confidently-canonical offering deprecated using models.dev's status field", async () => {
    const models = structuredClone(exampleFeed.models);
    // The fixture's own OpenRouter offering already canonicalizes with high
    // confidence (see canonicalize.ts); mark its own provider_model_id
    // deprecated in the models.dev payload for this run.
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === MODELS_DEV_API_URL) {
        return new Response(
          JSON.stringify({
            openrouter: {
              models: {
                "qwen/qwen3-coder:free": { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder (free)", status: "deprecated" }
              }
            }
          }),
          { status: 200 }
        );
      }
      if (url === ARTIFICIAL_ANALYSIS_API_URL) {
        return new Response(JSON.stringify(artificialAnalysisPayload), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await enrichModels(models, {
      now: new Date("2026-07-11T12:00:00.000Z"),
      fetch: fetchImpl,
      env: { ARTIFICIALANALYSIS_API_KEY: "aa_test_key" }
    });

    const model = result.models.find((m) => m.id === "openrouter:qwen/qwen3-coder:free");
    expect(model?.availability.status).toBe("deprecated");
    expect(result.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collector: "models-dev-deprecation",
          message: "marked offerings deprecated from models.dev status",
          deprecated_count: 1
        })
      ])
    );
  });

  it("catalog absence still wins over models.dev deprecation: an offering missing from this run follows the lifecycle's unknown path", async () => {
    // The fixture's OpenRouter offering is not fetched at all this run (it is
    // simply left out of the models array passed to enrichModels). models.dev
    // marks its id deprecated anyway. ADR 0008's precedence rule says catalog
    // absence outranks a models.dev signal — the offering must become
    // `unknown` via the availability lifecycle, never `deprecated`.
    const missingOffering = structuredClone(exampleFeed.models[0]);
    const remainingModels = structuredClone(exampleFeed.models).filter((m) => m.id !== missingOffering.id);

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === MODELS_DEV_API_URL) {
        return new Response(
          JSON.stringify({
            openrouter: {
              models: {
                [missingOffering.provider_model_id]: {
                  id: missingOffering.provider_model_id,
                  name: "Qwen3 Coder (free)",
                  status: "deprecated"
                }
              }
            }
          }),
          { status: 200 }
        );
      }
      return new Response("unavailable", { status: 503 });
    };
    const context: CollectorContext = {
      now: new Date("2026-07-11T12:00:00.000Z"),
      fetch: fetchImpl,
      env: {}
    };

    const enriched = await enrichModels(remainingModels, context);
    expect(enriched.models.find((m) => m.id === missingOffering.id)).toBeUndefined();

    const previousRelease: FeedDocument = { ...structuredClone(exampleFeed), models: [missingOffering] };
    const lifecycle = applyAvailabilityLifecycle({
      previousRelease,
      currentModels: enriched.models,
      notices: enriched.notices,
      now: context.now
    });

    const carriedForward = lifecycle.models.find((m) => m.id === missingOffering.id);
    expect(carriedForward?.availability.status).toBe("unknown");
  });
});
