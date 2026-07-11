import { CANONICAL_ALIASES } from "../feed/canonical-aliases";
import type { ModelOffering } from "../feed/schema";
import { collectorNotice } from "../collectors/shared";
import type { CollectorNotice } from "../collectors/types";

type CanonicalModel = NonNullable<ModelOffering["canonical_model"]>;

export type CanonicalizeResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
};

function stripOpenRouterVariant(providerModelId: string): string {
  return providerModelId.replace(/:[^:]+$/, "");
}

function canonicalModel(
  model: ModelOffering,
  id: string,
  confidence: CanonicalModel["confidence"]
): CanonicalModel {
  return {
    id,
    confidence,
    knowledge_cutoff: model.canonical_model?.knowledge_cutoff ?? null,
    release_date: model.canonical_model?.release_date ?? null,
    open_weights: model.canonical_model?.open_weights ?? null
  };
}

/**
 * Resolves offerings to the OpenRouter creator/model slug namespace without
 * changing unmatched non-OpenRouter offerings, and reports (without pruning —
 * per ADR 0003, that stays a human review decision) any alias target absent
 * from this run's live OpenRouter catalog.
 */
export function canonicalize(models: ModelOffering[]): CanonicalizeResult {
  const liveOpenRouterSlugs = new Set(
    models
      .filter((model) => model.provider.id === "openrouter")
      .map((model) => stripOpenRouterVariant(model.provider_model_id))
  );

  const staleAliases = Object.entries(CANONICAL_ALIASES)
    .filter(([, target]) => !liveOpenRouterSlugs.has(target))
    .map(([key, target]) => ({ key, target }));

  const notices: CollectorNotice[] =
    staleAliases.length > 0
      ? [
          collectorNotice("canonicalize", "alias targets not found in current OpenRouter catalog", {
            stale_aliases: staleAliases
          })
        ]
      : [];

  const canonicalized = models.map((model) => {
    const alias = CANONICAL_ALIASES[model.id];
    if (alias) {
      if (model.canonical_model?.id === alias && model.canonical_model.confidence === "high") {
        return model;
      }

      return {
        ...model,
        canonical_model: canonicalModel(model, alias, "high")
      };
    }

    if (model.provider.id !== "openrouter") {
      return model;
    }

    const canonicalId = stripOpenRouterVariant(model.provider_model_id);
    if (model.canonical_model?.id === canonicalId) {
      return model;
    }

    return {
      ...model,
      canonical_model: canonicalModel(model, canonicalId, model.canonical_model?.confidence ?? "high")
    };
  });

  return { models: canonicalized, notices };
}
