import type { FeedDocument, FeedProfile, ModelOffering, Provider } from "../feed/schema";
import { exampleFeed } from "../feed/fixture";
import { DELEGATION_PROFILE_IDS, rankByProfile, type DelegationProfileId } from "../feed/ranking";
import { geminiCollector } from "./gemini";
import { githubModelsCollector } from "./github-models";
import { groqCollector } from "./groq";
import { openrouterCollector } from "./openrouter";
import { opencodeGoCollector, opencodeZenCollector } from "./opencode";
import { clineCollector, clinePassCollector } from "./cline";
import { qwencloudCollector, qwencloudTokenPlanCollector } from "./qwencloud";
import type { Collector, CollectorContext, CollectorResult } from "./types";

export const collectors: Collector[] = [
  openrouterCollector,
  groqCollector,
  geminiCollector,
  githubModelsCollector,
  opencodeGoCollector,
  opencodeZenCollector,
  clineCollector,
  clinePassCollector,
  qwencloudCollector,
  qwencloudTokenPlanCollector
];

export type CollectorExecution = {
  collector: Collector;
  result: CollectorResult;
};

type DelegationProfileMeta = {
  display_name: string;
  description: string;
  criteria: Record<string, unknown>;
};

// One entry per DELEGATION_PROFILE_IDS. `criteria` restates the predicate and
// comparator from src/feed/ranking.ts in plain, machine-readable terms — it
// must never claim a rule the comparator does not apply. See ADR 0010.
const DELEGATION_PROFILE_META: Record<DelegationProfileId, DelegationProfileMeta> = {
  "best-free-coder": {
    display_name: "Best Free Coding Model",
    description:
      "The best-scoring coding offering that costs nothing today, ranked by availability, a fresh free claim, and pricing kind before quality.",
    criteria: {
      requires: {
        capabilities: ["coding"],
        pricing_kind: ["free", "free_tier", "subscription_included", "trial", "local"]
      },
      ordered_by: [
        "availability",
        "non_stale_free_claim",
        "pricing_kind_preference",
        "coding_score",
        "tool_use",
        "structured_output",
        "context_tokens",
        "id"
      ]
    }
  },
  "best-coder": {
    display_name: "Best Coding Model",
    description: "The highest coding-score offering with tool use, at any price.",
    criteria: {
      requires: { capabilities: ["tool_use"], coding_score: "not_null" },
      ordered_by: ["coding_score", "blended_price_per_1m_tokens", "id"]
    }
  },
  "best-agentic": {
    display_name: "Best Agentic Model",
    description: "The highest agentic-score offering with tool use and structured output.",
    criteria: {
      requires: { capabilities: ["tool_use", "structured_output"], agentic_score: "not_null" },
      ordered_by: ["agentic_score", "id"]
    }
  },
  "best-value-coder": {
    display_name: "Best Value Coding Model",
    description: "The paid offering with the highest coding score per dollar spent.",
    criteria: {
      requires: {
        pricing_kind: "paid",
        input_usd_per_1m_tokens: "not_null",
        output_usd_per_1m_tokens: "not_null",
        coding_score: "not_null"
      },
      ordered_by: ["coding_score_per_blended_price", "id"]
    }
  }
};

/**
 * Builds the feed's profiles[] from its own final model set. rankByProfile
 * already restricts candidates to policy.visibility === "listed", so a
 * retired or hidden offering can never be recommended here. A profile whose
 * pool is empty is omitted entirely — never emitted with a null selection —
 * so a consumer can tell "no model qualifies" from "this feature is broken".
 */
function generateDelegationProfiles(
  models: ModelOffering[],
  generatedAt: Date,
  defaultStaleAfterSeconds: number
): FeedProfile[] {
  const selectedAt = generatedAt.toISOString();
  const expiresAt = new Date(generatedAt.getTime() + defaultStaleAfterSeconds * 1000).toISOString();

  const profiles: FeedProfile[] = [];
  for (const profileId of DELEGATION_PROFILE_IDS) {
    const winner = rankByProfile(models, profileId, generatedAt)[0];
    if (!winner) continue;

    const meta = DELEGATION_PROFILE_META[profileId];
    profiles.push({
      id: profileId,
      object: "profile",
      display_name: meta.display_name,
      description: meta.description,
      selection: {
        model_offering_id: winner.id,
        selected_at: selectedAt,
        expires_at: expiresAt
      },
      criteria: meta.criteria
    });
  }

  return profiles;
}

function computeCollectorFeedExpiresAt(baseFeed: FeedDocument, generatedAt: Date): string {
  const baseGeneratedAtMs = Date.parse(baseFeed.feed.generated_at);
  const baseExpiresAtMs = baseFeed.feed.expires_at ? Date.parse(baseFeed.feed.expires_at) : Number.NaN;
  const derivedTtlMs = baseExpiresAtMs - baseGeneratedAtMs;
  const ttlMs =
    Number.isFinite(derivedTtlMs) && derivedTtlMs > 0
      ? derivedTtlMs
      : baseFeed.feed.default_stale_after_seconds * 1000;

  return new Date(generatedAt.getTime() + ttlMs).toISOString();
}

export async function runCollectors(context: CollectorContext, collectorList: readonly Collector[] = collectors): Promise<{
  providers: Provider[];
  models: ModelOffering[];
  notices: Record<string, unknown>[];
  executions: CollectorExecution[];
  results: CollectorResult[];
}> {
  const executions = await Promise.all(
    collectorList.map(async (collector: Collector) => ({
      collector,
      result: await collector.collect(context)
    }))
  );

  const providers = executions.map(({ result }) => result.provider);
  const models = executions.flatMap(({ result }) => result.models);
  const notices = executions.flatMap(({ result }) => result.notices);

  return {
    providers,
    models,
    notices,
    executions,
    results: executions.map(({ result }) => result)
  };
}

export function mergeCollectorFeed(
  baseFeed: FeedDocument,
  providers: Provider[],
  models: ModelOffering[],
  notices: Record<string, unknown>[],
  generatedAt: Date = new Date()
): FeedDocument {
  const generatedAtIso = generatedAt.toISOString();
  const providerById = new Map(providers.map((provider: Provider) => [provider.id, provider] as const));

  // A provider catalog can list the same model twice with conflicting data.
  // Cline's catalog lists x-ai/grok-4.5 twice: one entry has a 500k context at
  // $2/$6 per 1M tokens, the other reports a zero context and zero prices. A
  // Map built by overwrite would silently publish whichever copy came last, so
  // a reordering upstream could turn a paid model into a free one. Keep the
  // first occurrence, which is stable, and record every collision.
  const modelById = new Map<string, ModelOffering>();
  const duplicateModelNotices: Record<string, unknown>[] = [];
  for (const model of models) {
    const existing = modelById.get(model.id);
    if (existing) {
      duplicateModelNotices.push({
        collector: "feed-merge",
        message: "duplicate offering id: kept the first, discarded the rest",
        model_offering_id: model.id,
        kept_pricing_kind: existing.pricing.kind,
        discarded_pricing_kind: model.pricing.kind
      });
      continue;
    }
    modelById.set(model.id, model);
  }

  // The base feed's own profiles never flow into a collector feed — they are
  // fixture data selecting fixture offerings that no collector produces.
  // Generate profiles from this run's own final model set instead, so every
  // selection.model_offering_id is guaranteed to exist in `models`.
  const finalModels = [...modelById.values()];
  const profiles = generateDelegationProfiles(
    finalModels,
    generatedAt,
    baseFeed.feed.default_stale_after_seconds
  );

  return {
    ...baseFeed,
    feed: {
      ...baseFeed.feed,
      generated_at: generatedAtIso,
      expires_at: computeCollectorFeedExpiresAt(baseFeed, generatedAt),
      source_revision: `collector-run-${generatedAtIso}`
    },
    providers: [...providerById.values()],
    models: finalModels,
    profiles,
    notices: [...baseFeed.notices, ...notices, ...duplicateModelNotices]
  };
}

export function getFixtureFeed(): FeedDocument {
  return exampleFeed;
}
