import type { FeedDocument, ModelOffering, Provider } from "../feed/schema";
import { exampleFeed } from "../feed/fixture";
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

  // A profile selects one offering by id, and the feed schema rejects a profile
  // whose selection is missing from `models`. The base feed's profiles are
  // fixture data selecting fixture offerings, which no collector produces, so
  // carrying them over would publish an invalid document. Drop each dangling
  // profile and record why. Profile generation from live offerings is separate
  // work; until it lands a collector feed legitimately publishes no profiles.
  const danglingProfiles = baseFeed.profiles.filter(
    (profile) => !modelById.has(profile.selection.model_offering_id)
  );
  const profiles = baseFeed.profiles.filter((profile) =>
    modelById.has(profile.selection.model_offering_id)
  );
  const droppedProfileNotices = danglingProfiles.map((profile) => ({
    collector: "feed-merge",
    message: "profile dropped: selected offering not in collector output",
    profile_id: profile.id,
    model_offering_id: profile.selection.model_offering_id
  }));

  return {
    ...baseFeed,
    feed: {
      ...baseFeed.feed,
      generated_at: generatedAtIso,
      expires_at: computeCollectorFeedExpiresAt(baseFeed, generatedAt),
      source_revision: `collector-run-${generatedAtIso}`
    },
    providers: [...providerById.values()],
    models: [...modelById.values()],
    profiles,
    notices: [...baseFeed.notices, ...notices, ...duplicateModelNotices, ...droppedProfileNotices]
  };
}

export function getFixtureFeed(): FeedDocument {
  return exampleFeed;
}
