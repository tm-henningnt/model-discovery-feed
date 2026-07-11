import type { ModelOffering } from "../feed/schema";
import type { CollectorContext, CollectorNotice } from "../collectors/types";
import { canonicalize } from "./canonicalize";
import { enrichWithModelsDev } from "./models-dev";
import {
  enrichWithArtificialAnalysis,
  type ArtificialAnalysisResponse,
  type ArtificialAnalysisSnapshot
} from "./artificial-analysis";
import { propagateScores } from "./propagate-scores";

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
 * The shared four-stage enrichment pipeline: canonicalize model ids, gap-fill
 * from models.dev, layer in Artificial Analysis scores, then propagate
 * intrinsic scores across confidently-canonical twins. Both the DB-less
 * collect script and the DB-backed publish path run this identically; only
 * `fallbackSnapshot` differs between them (the publish path has a snapshot
 * store to carry forward from on fetch failure, per CON-004 — the DB-less
 * path does not, so it omits the option).
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
  const artificialAnalysis = await enrichWithArtificialAnalysis({
    models: modelsDev.models,
    context,
    fallbackSnapshot: options.fallbackSnapshot ?? null
  });
  const propagatedScores = propagateScores(artificialAnalysis.models);

  return {
    models: propagatedScores.models,
    notices: [
      ...canonicalized.notices,
      ...modelsDev.notices,
      ...artificialAnalysis.notices,
      ...propagatedScores.notices
    ],
    artificialAnalysis: {
      attemptedFetch: artificialAnalysis.attemptedFetch,
      notices: artificialAnalysis.notices,
      snapshotToPersist: artificialAnalysis.snapshotToPersist
    }
  };
}
