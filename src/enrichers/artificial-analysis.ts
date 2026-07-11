import type { ModelOffering, SourceClaim } from "../feed/schema";
import { claim, collectorNotice, fetchJson, normalizeText } from "../collectors/shared";
import type { CollectorContext, CollectorNotice } from "../collectors/types";
import { z } from "zod";

export const ARTIFICIAL_ANALYSIS_API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
export const ARTIFICIAL_ANALYSIS_SOURCE_URL = "https://artificialanalysis.ai/";
export const ARTIFICIAL_ANALYSIS_COLLECTOR_ID = "artificial-analysis";
export const ARTIFICIAL_ANALYSIS_SNAPSHOT_TYPE = "artificial_analysis_api_response";

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SUB_BENCHMARK_KEYS = new Set([
  "mmlu_pro",
  "gpqa",
  "hle",
  "livecodebench",
  "scicode",
  "math_500",
  "aime",
  "aime_25",
  "ifbench",
  "lcr",
  "terminalbench_hard",
  "terminalbench_v2_1",
  "tau2",
  "tau_banking"
]);

const artificialAnalysisModelSchema = z
  .object({
    id: z.unknown().optional(),
    name: z.unknown().optional(),
    slug: z.unknown().optional(),
    model_creator: z
      .object({
        id: z.unknown().optional(),
        name: z.unknown().optional(),
        slug: z.unknown().optional()
      })
      .passthrough()
      .nullable()
      .optional(),
    evaluations: z.record(z.unknown()).nullable().optional(),
    median_output_tokens_per_second: z.unknown().optional(),
    median_time_to_first_token_seconds: z.unknown().optional(),
    median_time_to_first_answer_token: z.unknown().optional()
  })
  .passthrough();

const artificialAnalysisResponseSchema = z
  .object({
    status: z.unknown().optional(),
    prompt_options: z.unknown().optional(),
    data: z.array(artificialAnalysisModelSchema)
  })
  .passthrough();

type ArtificialAnalysisModel = z.infer<typeof artificialAnalysisModelSchema>;
export type ArtificialAnalysisResponse = z.infer<typeof artificialAnalysisResponseSchema>;

export type ArtificialAnalysisSnapshot = {
  id: string;
  observedAt: Date | string;
  body: unknown;
};

export type ArtificialAnalysisEnrichmentResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
  snapshotToPersist: ArtificialAnalysisResponse | null;
  attemptedFetch: boolean;
  usedSnapshot: boolean;
};

type SnapshotSource = {
  body: ArtificialAnalysisResponse;
  observedAt: string;
  snapshotId: string;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function responseBody(value: unknown): ArtificialAnalysisResponse | null {
  const result = artificialAnalysisResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

function snapshotObservedAt(snapshot: ArtificialAnalysisSnapshot): string | null {
  const value = snapshot.observedAt instanceof Date ? snapshot.observedAt : new Date(snapshot.observedAt);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function normalizedName(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const normalized = text
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return normalized.length > 0 ? normalized : null;
}

function creatorMatches(canonicalCreator: string, creatorNames: Set<string>): boolean {
  if (creatorNames.has(canonicalCreator)) {
    return true;
  }

  return [...creatorNames].some(
    (creator) =>
      creator.length >= 3 &&
      canonicalCreator.length >= 3 &&
      (creator.startsWith(canonicalCreator) || canonicalCreator.startsWith(creator))
  );
}

function canonicalIdsForEntry(entry: ArtificialAnalysisModel, models: ModelOffering[]): string[] {
  const entryName = normalizedName(entry.name);
  if (!entryName) {
    return [];
  }

  const creatorNames = new Set(
    [entry.model_creator?.id, entry.model_creator?.name, entry.model_creator?.slug]
      .map(normalizedName)
      .filter((value): value is string => value !== null)
  );
  if (creatorNames.size === 0) {
    return [];
  }

  const matches = new Set<string>();
  for (const model of models) {
    const canonicalId = model.canonical_model?.id;
    if (!canonicalId) {
      continue;
    }

    const slash = canonicalId.indexOf("/");
    if (slash <= 0 || slash === canonicalId.length - 1) {
      continue;
    }

    const canonicalCreator = normalizedName(canonicalId.slice(0, slash));
    if (!canonicalCreator || !creatorMatches(canonicalCreator, creatorNames)) {
      continue;
    }

    const candidateNames = [
      canonicalId.slice(slash + 1),
      model.provider_model_id.split("/").at(-1),
      model.display_name
    ]
      .map(normalizedName)
      .filter((value): value is string => value !== null);

    if (candidateNames.includes(entryName)) {
      matches.add(canonicalId);
    }
  }

  return [...matches];
}

function subBenchmarks(evaluations: Record<string, unknown> | null | undefined): Record<string, number> | null {
  if (!evaluations) {
    return null;
  }

  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(evaluations)) {
    const numeric = finiteNumber(value);
    if (numeric !== null && SUB_BENCHMARK_KEYS.has(key)) {
      values[key] = numeric;
    }
  }

  return Object.keys(values).length > 0 ? values : null;
}

function removeSupersededClaimPaths(claims: SourceClaim[], fieldPaths: string[]): SourceClaim[] {
  const superseded = new Set(fieldPaths);
  return claims.flatMap((existing) => {
    const remaining = existing.field_paths.filter((fieldPath) => !superseded.has(fieldPath));
    return remaining.length > 0 ? [{ ...existing, field_paths: remaining }] : [];
  });
}

export function clearArtificialAnalysisEndpointScores(model: ModelOffering): ModelOffering {
  const benchmarks = model.quality.benchmarks;
  return {
    ...model,
    quality: {
      ...model.quality,
      speed_score: null,
      benchmarks: {
        math_score: benchmarks?.math_score ?? null,
        ttft_seconds: null,
        artificial_analysis: benchmarks?.artificial_analysis ?? null,
        design_arena: benchmarks?.design_arena ?? null
      }
    },
    source_claims: removeSupersededClaimPaths(model.source_claims, [
      "quality.speed_score",
      "quality.benchmarks.ttft_seconds"
    ])
  };
}

function isDefaultVariantName(value: unknown): boolean {
  const text = normalizeText(value);
  return Boolean(text) && !/\([^)]*\)/.test(text as string);
}

/**
 * AA's payload lists multiple reasoning-effort/quantization variants under
 * the same underlying model name (e.g. "gpt-5.6-sol", "gpt-5.6-sol (low)").
 * Several can normalize to the same canonical id; picking whichever appears
 * last in the payload would make published scores depend on AA's arbitrary
 * ordering. Prefer the un-parenthesized "default" variant name, then the
 * highest intelligence index, so the choice is deterministic regardless of
 * payload order.
 */
function preferEntry(a: ArtificialAnalysisModel, b: ArtificialAnalysisModel): ArtificialAnalysisModel {
  const aDefault = isDefaultVariantName(a.name);
  const bDefault = isDefaultVariantName(b.name);
  if (aDefault !== bDefault) {
    return aDefault ? a : b;
  }

  const aScore = finiteNumber(a.evaluations?.artificial_analysis_intelligence_index) ?? -Infinity;
  const bScore = finiteNumber(b.evaluations?.artificial_analysis_intelligence_index) ?? -Infinity;
  return aScore >= bScore ? a : b;
}

type IndexedEntry = { entry: ArtificialAnalysisModel; index: number };

function preferIndexedEntry(a: IndexedEntry, b: IndexedEntry): IndexedEntry {
  return preferEntry(a.entry, b.entry) === a.entry ? a : b;
}

function enrichFromSource(models: ModelOffering[], source: SnapshotSource): {
  models: ModelOffering[];
  unmatchedCount: number;
} {
  const enrichmentByCanonicalId = new Map<
    string,
    { entry: ArtificialAnalysisModel; index: number }
  >();
  let unmatchedCount = 0;

  source.body.data.forEach((entry, index) => {
    const canonicalIds = canonicalIdsForEntry(entry, models);
    if (canonicalIds.length === 0) {
      unmatchedCount += 1;
      return;
    }

    for (const canonicalId of canonicalIds) {
      const existing = enrichmentByCanonicalId.get(canonicalId);
      const candidate = { entry, index };
      enrichmentByCanonicalId.set(canonicalId, existing ? preferIndexedEntry(existing, candidate) : candidate);
    }
  });

  return {
    models: models.map((original) => {
      const model = clearArtificialAnalysisEndpointScores(original);
      // AA direct replaces the AA values republished on OpenRouter. Other
      // providers receive model-intrinsic values only through the final
      // canonical propagation stage, with medium-confidence join provenance.
      if (model.provider.id !== "openrouter") {
        return model;
      }
      const match = model.canonical_model?.id
        ? enrichmentByCanonicalId.get(model.canonical_model.id)
        : undefined;
      if (!match) {
        return model;
      }

      const evaluations = match.entry.evaluations;
      const reasoningScore = finiteNumber(evaluations?.artificial_analysis_intelligence_index);
      const codingScore = finiteNumber(evaluations?.artificial_analysis_coding_index);
      const mathScore = finiteNumber(evaluations?.artificial_analysis_math_index);
      const artificialAnalysis = subBenchmarks(evaluations);
      const fieldPaths = [
        codingScore !== null ? "quality.coding_score" : null,
        reasoningScore !== null ? "quality.reasoning_score" : null,
        mathScore !== null ? "quality.benchmarks.math_score" : null,
        artificialAnalysis !== null ? "quality.benchmarks.artificial_analysis" : null
      ].filter((fieldPath): fieldPath is string => fieldPath !== null);

      if (fieldPaths.length === 0) {
        return model;
      }

      const existingBenchmarks = model.quality.benchmarks;
      const aaClaim = claim({
        id: `${ARTIFICIAL_ANALYSIS_COLLECTOR_ID}:${model.id}:${match.index}`,
        collector: ARTIFICIAL_ANALYSIS_COLLECTOR_ID,
        sourceType: "third_party_catalog",
        sourceUrl: ARTIFICIAL_ANALYSIS_SOURCE_URL,
        observedAt: source.observedAt,
        fieldPaths,
        confidence: "high",
        rawReference: {
          snapshot_id: source.snapshotId,
          json_pointer: `/data/${match.index}/evaluations`,
          artificial_analysis_model_id: normalizeText(match.entry.id)
        }
      });

      return {
        ...model,
        quality: {
          ...model.quality,
          coding_score: codingScore ?? model.quality.coding_score,
          reasoning_score: reasoningScore ?? model.quality.reasoning_score,
          // AA direct has no agentic index. Preserve the embed-sourced value.
          agentic_score: model.quality.agentic_score,
          speed_score: null,
          benchmarks: {
            math_score: mathScore ?? existingBenchmarks?.math_score ?? null,
            ttft_seconds: null,
            artificial_analysis: artificialAnalysis ?? existingBenchmarks?.artificial_analysis ?? null,
            design_arena: existingBenchmarks?.design_arena ?? null
          }
        },
        source_claims: [...removeSupersededClaimPaths(model.source_claims, fieldPaths), aaClaim]
      };
    }),
    unmatchedCount
  };
}

export async function enrichWithArtificialAnalysis(options: {
  models: ModelOffering[];
  context: CollectorContext;
  fallbackSnapshot?: ArtificialAnalysisSnapshot | null;
}): Promise<ArtificialAnalysisEnrichmentResult> {
  const notices: CollectorNotice[] = [];
  const apiKey = normalizeText(options.context.env.ARTIFICIALANALYSIS_API_KEY);
  let source: SnapshotSource | null = null;
  let snapshotToPersist: ArtificialAnalysisResponse | null = null;
  let attemptedFetch = false;
  let fetchFailure: { status: number; error: string } | null = null;

  if (apiKey) {
    attemptedFetch = true;
    const response = await fetchJson<ArtificialAnalysisResponse>(options.context, ARTIFICIAL_ANALYSIS_API_URL, {
      headers: { "x-api-key": apiKey }
    });

    if (response.ok) {
      const body = responseBody(response.data);
      if (body) {
        snapshotToPersist = body;
        source = {
          body,
          observedAt: options.context.now.toISOString(),
          snapshotId: "artificial-analysis-live-response"
        };
      } else {
        fetchFailure = { status: response.status, error: "response data is not an array" };
      }
    } else {
      fetchFailure = { status: response.status, error: response.error };
    }
  } else {
    fetchFailure = { status: 0, error: "ARTIFICIALANALYSIS_API_KEY is not configured" };
  }

  let usedSnapshot = false;
  if (!source && options.fallbackSnapshot) {
    const body = responseBody(options.fallbackSnapshot.body);
    const observedAt = snapshotObservedAt(options.fallbackSnapshot);
    if (body && observedAt) {
      source = {
        body,
        observedAt,
        snapshotId: options.fallbackSnapshot.id
      };
      usedSnapshot = true;
    }
  }

  if (fetchFailure) {
    notices.push(
      collectorNotice(ARTIFICIAL_ANALYSIS_COLLECTOR_ID, "Artificial Analysis API unavailable", {
        status: fetchFailure.status,
        error: fetchFailure.error,
        used_snapshot: usedSnapshot
      })
    );
  }

  if (!source) {
    return {
      models: options.models.map(clearArtificialAnalysisEndpointScores),
      notices,
      snapshotToPersist,
      attemptedFetch,
      usedSnapshot
    };
  }

  if (usedSnapshot && options.context.now.getTime() - Date.parse(source.observedAt) > STALE_AFTER_MS) {
    notices.push(
      collectorNotice(ARTIFICIAL_ANALYSIS_COLLECTOR_ID, "Artificial Analysis snapshot is more than 7 days old", {
        observed_at: source.observedAt,
        snapshot_id: source.snapshotId
      })
    );
  }

  const enriched = enrichFromSource(options.models, source);
  if (enriched.unmatchedCount > 0) {
    notices.push(
      collectorNotice(ARTIFICIAL_ANALYSIS_COLLECTOR_ID, "Artificial Analysis models were not matched", {
        unmatched_model_count: enriched.unmatchedCount
      })
    );
  }

  return {
    models: enriched.models,
    notices,
    snapshotToPersist,
    attemptedFetch,
    usedSnapshot
  };
}
