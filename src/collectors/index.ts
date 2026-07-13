import type { FeedDocument, ModelOffering, Provider } from "../feed/schema";
import { exampleFeed } from "../feed/fixture";
import { geminiCollector } from "./gemini";
import { githubModelsCollector } from "./github-models";
import { groqCollector } from "./groq";
import { openrouterCollector } from "./openrouter";
import { opencodeGoCollector, opencodeZenCollector } from "./opencode";
import { clineCollector, clinePassCollector } from "./cline";
import type { Collector, CollectorContext, CollectorResult } from "./types";

export const collectors: Collector[] = [
  openrouterCollector,
  groqCollector,
  geminiCollector,
  githubModelsCollector,
  opencodeGoCollector,
  opencodeZenCollector,
  clineCollector,
  clinePassCollector
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
  const providerById = new Map(baseFeed.providers.map((provider: Provider) => [provider.id, provider] as const));
  for (const provider of providers) {
    providerById.set(provider.id, provider);
  }

  const modelById = new Map(baseFeed.models.map((model: ModelOffering) => [model.id, model] as const));
  for (const model of models) {
    modelById.set(model.id, model);
  }

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
    notices: [...baseFeed.notices, ...notices]
  };
}

export function getFixtureFeed(): FeedDocument {
  return exampleFeed;
}
