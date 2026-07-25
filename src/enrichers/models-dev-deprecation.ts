import { claim, collectorNotice } from "../collectors/shared";
import type { CollectorNotice } from "../collectors/types";
import type { ModelOffering } from "../feed/schema";
import { MODELS_DEV_SOURCE_URL, modelsDevProviderByProviderId, type ModelsDevResponse } from "./models-dev";

export const MODELS_DEV_DEPRECATION_COLLECTOR_ID = "models-dev-deprecation";

export type ModelsDevDeprecationResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
};

/**
 * ADR 0008 status precedence rule (c): a models.dev `status: "deprecated"`
 * entry sets `availability.status: "deprecated"`, but only under two guards.
 *
 * First, first-party evidence wins: an offering a higher-precedence rule
 * already moved off `available` (catalog absence, or an OpenRouter
 * expiration date) is left untouched here.
 *
 * Second, the match must already be confident: the offering's
 * `canonical_model.confidence` must be `"high"`. This stage never builds a
 * new or fuzzy join — it looks the offering up in the models.dev catalog by
 * the same exact provider-id mapping and provider_model_id key that
 * `retireOpencodeModels` uses, and the confidence check on top of that guards
 * against treating a merely-plausible canonical match as a status signal.
 *
 * Runs after `enrichWithModelsDev` and `retireOpencodeModels` so it reuses
 * the catalog already fetched this run — it never fetches models.dev itself.
 */
export function applyModelsDevDeprecation(
  models: ModelOffering[],
  catalog: ModelsDevResponse | null,
  observedAt: string
): ModelsDevDeprecationResult {
  if (catalog === null) {
    return { models, notices: [] };
  }

  let deprecatedCount = 0;

  const result = models.map((model) => {
    if (model.availability.status !== "available") {
      return model;
    }
    if (model.canonical_model?.confidence !== "high") {
      return model;
    }

    const modelsDevProviderId = modelsDevProviderByProviderId[model.provider.id];
    if (!modelsDevProviderId) {
      return model;
    }

    const entry = catalog[modelsDevProviderId]?.models?.[model.provider_model_id];
    if (!entry || entry.status !== "deprecated") {
      return model;
    }

    deprecatedCount += 1;

    return {
      ...model,
      availability: {
        ...model.availability,
        status: "deprecated" as const
      },
      source_claims: [
        ...model.source_claims,
        claim({
          id: `${MODELS_DEV_DEPRECATION_COLLECTOR_ID}:${model.id}`,
          collector: MODELS_DEV_DEPRECATION_COLLECTOR_ID,
          sourceType: "third_party_catalog",
          sourceUrl: MODELS_DEV_SOURCE_URL,
          observedAt,
          fieldPaths: ["availability.status"],
          confidence: "medium",
          rawReference: {
            rule: "models_dev_deprecated",
            models_dev_provider_id: modelsDevProviderId,
            provider_model_id: model.provider_model_id
          }
        })
      ]
    };
  });

  const notices: CollectorNotice[] =
    deprecatedCount > 0
      ? [
          collectorNotice(MODELS_DEV_DEPRECATION_COLLECTOR_ID, "marked offerings deprecated from models.dev status", {
            deprecated_count: deprecatedCount
          })
        ]
      : [];

  return { models: result, notices };
}
