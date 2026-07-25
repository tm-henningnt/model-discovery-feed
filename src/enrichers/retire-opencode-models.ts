import { collectorNotice } from "../collectors/shared";
import type { CollectorNotice } from "../collectors/types";
import type { ModelOffering } from "../feed/schema";
import { modelsDevProviderByProviderId, type ModelsDevResponse } from "./models-dev";

export const RETIRE_OPENCODE_MODELS_COLLECTOR_ID = "retire-opencode-models";

// The OpenCode Go and Zen listing endpoints (https://opencode.ai/zen/go/v1/models,
// the Zen equivalent) only publish { id, object, created, owned_by } — `created` is
// identical across every entry, so the payload itself cannot tell a live model from a
// retired one. This stage runs after models.dev enrichment (which already fetched and
// parsed the catalog) so it can use models.dev's `status` field as the discriminator,
// without a second models.dev fetch.
const OPENCODE_PROVIDER_IDS = new Set(["opencode-go", "opencode-zen"]);

export type RetireOpencodeModelsResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
};

/**
 * Drops OpenCode Go/Zen offerings that models.dev marks `status: "deprecated"`, or that
 * are absent from models.dev entirely. Every other provider is left untouched: this
 * stage never matches an `opencode-go` offering against the `opencode` models.dev
 * provider, or the reverse, and it never fuzzy-matches ids.
 *
 * When the models.dev catalog is null (fetch failed or body was invalid), this stage
 * drops nothing and emits a single notice — a failed lookup must never shrink a roster.
 */
export function retireOpencodeModels(
  models: ModelOffering[],
  catalog: ModelsDevResponse | null
): RetireOpencodeModelsResult {
  if (catalog === null) {
    return {
      models,
      notices: [
        collectorNotice(RETIRE_OPENCODE_MODELS_COLLECTOR_ID, "models.dev catalog unavailable; dropped nothing", {})
      ]
    };
  }

  const kept: ModelOffering[] = [];
  const deprecatedIds: string[] = [];
  const absentIds: string[] = [];

  for (const model of models) {
    if (!OPENCODE_PROVIDER_IDS.has(model.provider.id)) {
      kept.push(model);
      continue;
    }

    const modelsDevProviderId = modelsDevProviderByProviderId[model.provider.id];
    const entry = modelsDevProviderId ? catalog[modelsDevProviderId]?.models?.[model.provider_model_id] : undefined;

    if (entry === undefined) {
      absentIds.push(model.id);
      continue;
    }

    if (entry.status === "deprecated") {
      deprecatedIds.push(model.id);
      continue;
    }

    kept.push(model);
  }

  const notices: CollectorNotice[] = [];
  if (deprecatedIds.length > 0) {
    notices.push(
      collectorNotice(RETIRE_OPENCODE_MODELS_COLLECTOR_ID, "dropped models.dev-deprecated OpenCode offerings", {
        offering_ids: deprecatedIds
      })
    );
  }
  if (absentIds.length > 0) {
    // Loud on purpose: a brand-new OpenCode model that models.dev has not indexed yet
    // would also be absent, and would be dropped by this same rule. This notice is the
    // only way that false-positive drop becomes visible — check it whenever an
    // OpenCode roster shrinks unexpectedly.
    notices.push(
      collectorNotice(
        RETIRE_OPENCODE_MODELS_COLLECTOR_ID,
        "dropped OpenCode offerings absent from models.dev — verify these are actually retired, not just new",
        { offering_ids: absentIds }
      )
    );
  }

  return { models: kept, notices };
}
