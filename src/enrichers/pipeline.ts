import type { ModelOffering } from "../feed/schema";
import type { CollectorContext, CollectorNotice } from "../collectors/types";
import { canonicalize } from "./canonicalize";
import { enrichWithModelsDev } from "./models-dev";
import { applyModelsDevDeprecation } from "./models-dev-deprecation";
import { retireOpencodeModels } from "./retire-opencode-models";
import {
  enrichWithArtificialAnalysis,
  type ArtificialAnalysisResponse,
  type ArtificialAnalysisSnapshot
} from "./artificial-analysis";
import { propagateScores } from "./propagate-scores";
import { deriveCodingCapability } from "./derive-coding-capability";
import { propagateCapabilities } from "./propagate-capabilities";

export type EnrichModelsResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
  artificialAnalysis: {
    attemptedFetch: boolean;
    notices: CollectorNotice[];
    snapshotToPersist: ArtificialAnalysisResponse | null;
  };
};

/**
 * The shared seven-stage enrichment pipeline: canonicalize model ids,
 * gap-fill from models.dev, drop retired OpenCode Go/Zen offerings using that
 * same models.dev catalog, mark a confidently-canonical offering `deprecated`
 * when models.dev status says so (ADR 0008 rule (c) — reuses the same
 * catalog again), layer in Artificial Analysis scores, propagate intrinsic
 * scores across confidently-canonical twins, then derive the `coding`
 * capability (ADR 0009), then propagate model-shaped capabilities
 * (`coding`, `vision`, `reasoning`) across confidently-canonical twins (ADR
 * 0011). The capability-propagation stage runs last, after coding
 * derivation, so a derived `coding` flag counts as evidence for the whole
 * canonical group too. Both the DB-less collect script and the DB-backed
 * publish path run this identically; only `fallbackSnapshot` differs between
 * them (the publish path has a snapshot store to carry forward from on fetch
 * failure, per CON-004 — the DB-less path does not, so it omits the option).
 */
export async function enrichModels(
  models: ModelOffering[],
  context: CollectorContext,
  options: { fallbackSnapshot?: ArtificialAnalysisSnapshot | null } = {}
): Promise<EnrichModelsResult> {
  const canonicalized = canonicalize(models);
  const modelsDev = await enrichWithModelsDev({
    models: canonicalized.models,
    context
  });
  const retiredOpencode = retireOpencodeModels(modelsDev.models, modelsDev.catalog);
  const modelsDevDeprecation = applyModelsDevDeprecation(
    retiredOpencode.models,
    modelsDev.catalog,
    context.now.toISOString()
  );
  const artificialAnalysis = await enrichWithArtificialAnalysis({
    models: modelsDevDeprecation.models,
    context,
    fallbackSnapshot: options.fallbackSnapshot ?? null
  });
  const propagatedScores = propagateScores(artificialAnalysis.models);
  const codingCapability = deriveCodingCapability(propagatedScores.models, context.now.toISOString());
  const propagatedCapabilities = propagateCapabilities(codingCapability.models, context.now.toISOString());

  return {
    models: propagatedCapabilities.models,
    notices: [
      ...canonicalized.notices,
      ...modelsDev.notices,
      ...retiredOpencode.notices,
      ...modelsDevDeprecation.notices,
      ...artificialAnalysis.notices,
      ...propagatedScores.notices,
      ...codingCapability.notices,
      ...propagatedCapabilities.notices
    ],
    artificialAnalysis: {
      attemptedFetch: artificialAnalysis.attemptedFetch,
      notices: artificialAnalysis.notices,
      snapshotToPersist: artificialAnalysis.snapshotToPersist
    }
  };
}
