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

/**
 * Providers that publish a model id equal to the model segment of an OpenRouter slug, with no creator
 * prefix (`glm-5.2` for `z-ai/glm-5.2`). Their canonical id is resolved against this run's live
 * OpenRouter catalog instead of a hand-maintained alias table, the same live-join reasoning ADR 0006
 * used for ClinePass and ADR 0007 reuses for QwenCloud.
 */
const SEGMENT_JOIN_PROVIDER_IDS = new Set(["qwencloud", "qwencloud-token-plan"]);

function openRouterSlugsBySegment(liveSlugs: Set<string>): Map<string, Set<string>> {
  const bySegment = new Map<string, Set<string>>();
  for (const slug of liveSlugs) {
    const separator = slug.indexOf("/");
    if (separator === -1) {
      continue;
    }

    const segment = slug.slice(separator + 1).toLowerCase();
    const existing = bySegment.get(segment);
    if (existing) {
      existing.add(slug);
    } else {
      bySegment.set(segment, new Set([slug]));
    }
  }

  return bySegment;
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

  const slugsBySegment = openRouterSlugsBySegment(liveOpenRouterSlugs);
  const ambiguousSegments: Array<{ offering_id: string; candidates: string[] }> = [];

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

    if (SEGMENT_JOIN_PROVIDER_IDS.has(model.provider.id)) {
      const candidates = slugsBySegment.get(model.provider_model_id.toLowerCase());
      if (!candidates) {
        return model;
      }

      // Two creators sharing a model segment would make the join distinct-to-one, which ADR 0003
      // forbids. Refuse it and leave the medium-confidence echo the collector set.
      if (candidates.size > 1) {
        ambiguousSegments.push({ offering_id: model.id, candidates: [...candidates].sort() });
        return model;
      }

      const [slug] = candidates;
      if (model.canonical_model?.id === slug && model.canonical_model.confidence === "high") {
        return model;
      }

      return {
        ...model,
        canonical_model: canonicalModel(model, slug, "high")
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

  if (ambiguousSegments.length > 0) {
    notices.push(
      collectorNotice("canonicalize", "model segment matched more than one OpenRouter creator", {
        ambiguous_offerings: ambiguousSegments
      })
    );
  }

  return { models: canonicalized, notices };
}
