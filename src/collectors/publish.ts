import { ZodError } from "zod";
import type { FeedDocument, Provider } from "../feed/schema";
import { validateFeedDocument } from "../feed/schema";
import {
  ARTIFICIAL_ANALYSIS_API_URL,
  ARTIFICIAL_ANALYSIS_COLLECTOR_ID,
  ARTIFICIAL_ANALYSIS_SNAPSHOT_TYPE,
  clearArtificialAnalysisEndpointScores,
  type ArtificialAnalysisSnapshot
} from "../enrichers/artificial-analysis";
import { enrichModels } from "../enrichers/pipeline";
import { RETIRE_OPENCODE_MODELS_COLLECTOR_ID } from "../enrichers/retire-opencode-models";
import { applyAvailabilityLifecycle } from "./availability-lifecycle";
import { getFixtureFeed, mergeCollectorFeed, runCollectors } from "./index";
import type { Collector, CollectorContext, CollectorNotice } from "./types";

/**
 * Collects the offering ids that an enrichment stage removed on positive
 * evidence of retirement. The availability lifecycle retires these at once and
 * excludes them from its mass-loss guard, so a deliberate bulk removal does not
 * read as a provider outage.
 */
function deliberatelyRetiredOfferingIds(enrichmentNotices: CollectorNotice[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const notice of enrichmentNotices) {
    if (notice.collector !== RETIRE_OPENCODE_MODELS_COLLECTOR_ID) continue;
    const offeringIds = notice.offering_ids;
    if (!Array.isArray(offeringIds)) continue;
    for (const id of offeringIds) {
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

type CollectorSnapshotBody = {
  provider: Provider;
  model_count: number;
  notices: CollectorNotice[];
  validation_error: string | null;
};

export type CollectorRunCreateData = {
  collector: string;
  status: string;
  startedAt: Date;
  finishedAt: Date;
  errorMessage: string | null;
};

export type SourceSnapshotCreateData = {
  sourceType: string;
  sourceUrl: string | null;
  collector: string;
  observedAt: Date;
  body: CollectorSnapshotBody | Record<string, unknown>;
  collectorRunId: string;
};

export type PrismaPublishClient = {
  collectorRun: {
    createManyAndReturn(args: {
      data: CollectorRunCreateData[];
      select: { id: true; collector: true };
    }): Promise<Array<{ id: string; collector: string }>>;
  };
  sourceSnapshot: {
    createMany(args: { data: SourceSnapshotCreateData[] }): Promise<unknown>;
    findFirst(args: {
      where: { collector: string; sourceType: string };
      orderBy: { observedAt: "desc" };
    }): Promise<{
      id: string;
      observedAt: Date;
      body: unknown;
    } | null>;
  };
  feedRelease: {
    create(args: {
      data: {
        status: string;
        generatedAt: Date;
        sourceRevision: string;
        snapshotJson: FeedDocument;
      };
    }): Promise<unknown>;
    findFirst(args: {
      where: { status: "published" };
      orderBy: { generatedAt: "desc" };
    }): Promise<{ snapshotJson: unknown } | null>;
  };
};

async function latestPublishedRelease(prisma: PrismaPublishClient): Promise<FeedDocument | null> {
  const release = await prisma.feedRelease.findFirst({
    where: { status: "published" },
    orderBy: { generatedAt: "desc" }
  });

  if (!release) {
    return null;
  }

  return validateFeedDocument(release.snapshotJson);
}

async function latestArtificialAnalysisSnapshot(
  prisma: PrismaPublishClient
): Promise<ArtificialAnalysisSnapshot | null> {
  return prisma.sourceSnapshot.findFirst({
    where: {
      collector: ARTIFICIAL_ANALYSIS_COLLECTOR_ID,
      sourceType: ARTIFICIAL_ANALYSIS_SNAPSHOT_TYPE
    },
    orderBy: { observedAt: "desc" }
  });
}

function collectorRunStatus(notices: CollectorNotice[]): string {
  return notices.length > 0 ? "completed_with_notices" : "completed";
}

function collectorRunErrorMessage(notices: CollectorNotice[], validationError: string | null): string | null {
  const messages = notices
    .map((notice) => notice.message)
    .filter((message): message is string => typeof message === "string" && message.length > 0);

  if (validationError) {
    messages.push(validationError);
  }

  return messages.length > 0 ? messages.join("; ") : null;
}

function validationErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    if (firstIssue?.message) {
      return `feed validation failed: ${firstIssue.message}`;
    }
  }

  if (error instanceof Error && error.message.length > 0) {
    return `feed validation failed: ${error.message}`;
  }

  return "feed validation failed";
}

export async function runCollectorsAndPublish(options: {
  context: CollectorContext;
  prisma: PrismaPublishClient;
  baseFeed?: FeedDocument;
  collectors?: readonly Collector[];
}): Promise<FeedDocument> {
  const baseFeed = options.baseFeed ?? getFixtureFeed();
  const { providers, models, notices, executions } = await runCollectors(options.context, options.collectors);
  const fallbackSnapshot = await latestArtificialAnalysisSnapshot(options.prisma);
  const enriched = await enrichModels(models, options.context, { fallbackSnapshot });

  // ADR 0008: the retirement diff needs the previous published release, which
  // only exists once a publish has happened. Its absence (first-ever publish)
  // is a legitimate no-baseline case, handled inside applyAvailabilityLifecycle.
  const previousRelease = await latestPublishedRelease(options.prisma);
  const lifecycle = applyAvailabilityLifecycle({
    previousRelease,
    currentModels: enriched.models,
    notices,
    now: options.context.now,
    deliberatelyRetiredIds: deliberatelyRetiredOfferingIds(enriched.notices)
  });

  const mergedFeed = mergeCollectorFeed(
    baseFeed,
    providers,
    lifecycle.models,
    [...notices, ...enriched.notices, ...lifecycle.notices],
    options.context.now
  );
  const merged = {
    ...mergedFeed,
    models: mergedFeed.models.map(clearArtificialAnalysisEndpointScores)
  };
  const generatedAt = new Date(merged.feed.generated_at);

  let validated: FeedDocument | null = null;
  let validationFailure: unknown = null;

  try {
    validated = validateFeedDocument(merged);
  } catch (error) {
    validationFailure = error;
  }

  const validationError = validationFailure ? validationErrorMessage(validationFailure) : null;

  // Prisma Accelerate caps interactive transactions at 15s, and one round-trip
  // per record blows past that, so batch everything into three requests instead:
  // all collector runs, then all snapshots, then the release. These are
  // append-only audit rows, so losing atomicity across them is acceptable.
  const runRows: CollectorRunCreateData[] = executions.map((execution) => ({
    collector: execution.collector.id,
    status: collectorRunStatus(execution.result.notices),
    startedAt: options.context.now,
    finishedAt: options.context.now,
    errorMessage: collectorRunErrorMessage(execution.result.notices, validationError)
  }));

  if (enriched.artificialAnalysis.attemptedFetch) {
    runRows.push({
      collector: ARTIFICIAL_ANALYSIS_COLLECTOR_ID,
      status: collectorRunStatus(enriched.artificialAnalysis.notices),
      startedAt: options.context.now,
      finishedAt: options.context.now,
      errorMessage: collectorRunErrorMessage(enriched.artificialAnalysis.notices, validationError)
    });
  }

  const createdRuns = runRows.length > 0
    ? await options.prisma.collectorRun.createManyAndReturn({
        data: runRows,
        select: { id: true, collector: true }
      })
    : [];
  const runIdByCollector = new Map(createdRuns.map((run) => [run.collector, run.id]));

  const runIdFor = (collector: string): string => {
    const runId = runIdByCollector.get(collector);
    if (!runId) {
      throw new Error(`collector run was not persisted for collector: ${collector}`);
    }
    return runId;
  };

  const snapshotRows: SourceSnapshotCreateData[] = executions.map((execution) => ({
    sourceType: "collector_result_summary",
    sourceUrl: execution.result.provider.homepage,
    collector: execution.collector.id,
    observedAt: options.context.now,
    body: {
      provider: execution.result.provider,
      model_count: execution.result.models.length,
      notices: execution.result.notices,
      validation_error: validationError
    },
    collectorRunId: runIdFor(execution.collector.id)
  }));

  if (enriched.artificialAnalysis.attemptedFetch && enriched.artificialAnalysis.snapshotToPersist) {
    snapshotRows.push({
      sourceType: ARTIFICIAL_ANALYSIS_SNAPSHOT_TYPE,
      sourceUrl: ARTIFICIAL_ANALYSIS_API_URL,
      collector: ARTIFICIAL_ANALYSIS_COLLECTOR_ID,
      observedAt: options.context.now,
      body: enriched.artificialAnalysis.snapshotToPersist as Record<string, unknown>,
      collectorRunId: runIdFor(ARTIFICIAL_ANALYSIS_COLLECTOR_ID)
    });
  }

  if (snapshotRows.length > 0) {
    await options.prisma.sourceSnapshot.createMany({ data: snapshotRows });
  }

  if (validated) {
    await options.prisma.feedRelease.create({
      data: {
        status: "published",
        generatedAt,
        sourceRevision: validated.feed.source_revision,
        snapshotJson: validated
      }
    });
  }

  if (validationFailure) {
    throw validationFailure;
  }

  return validated as FeedDocument;
}
