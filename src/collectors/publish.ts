import { ZodError } from "zod";
import type { FeedDocument, Provider } from "../feed/schema";
import { validateFeedDocument } from "../feed/schema";
import { getFixtureFeed, mergeCollectorFeed, runCollectors } from "./index";
import type { Collector, CollectorContext, CollectorNotice } from "./types";

type CollectorRunRecord = {
  id: string;
};

type CollectorSnapshotBody = {
  provider: Provider;
  model_count: number;
  notices: CollectorNotice[];
  validation_error: string | null;
};

export type PrismaPublishTransaction = {
  collectorRun: {
    create(args: {
      data: {
        collector: string;
        status: string;
        startedAt: Date;
        finishedAt: Date;
        errorMessage: string | null;
      };
    }): Promise<CollectorRunRecord>;
  };
  sourceSnapshot: {
    create(args: {
      data: {
        sourceType: string;
        sourceUrl: string | null;
        collector: string;
        observedAt: Date;
        body: CollectorSnapshotBody;
        collectorRunId: string;
      };
    }): Promise<unknown>;
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
  };
};

export type PrismaPublishClient = {
  $transaction<T>(callback: (tx: PrismaPublishTransaction) => Promise<T>): Promise<T>;
};

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
  const merged = mergeCollectorFeed(baseFeed, providers, models, notices, options.context.now);
  const generatedAt = new Date(merged.feed.generated_at);

  let validated: FeedDocument | null = null;
  let validationFailure: unknown = null;

  try {
    validated = validateFeedDocument(merged);
  } catch (error) {
    validationFailure = error;
  }

  const validationError = validationFailure ? validationErrorMessage(validationFailure) : null;

  await options.prisma.$transaction(async (tx) => {
    for (const execution of executions) {
      const run = await tx.collectorRun.create({
        data: {
          collector: execution.collector.id,
          status: collectorRunStatus(execution.result.notices),
          startedAt: options.context.now,
          finishedAt: options.context.now,
          errorMessage: collectorRunErrorMessage(execution.result.notices, validationError)
        }
      });

      await tx.sourceSnapshot.create({
        data: {
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
          collectorRunId: run.id
        }
      });
    }

    if (validated) {
      await tx.feedRelease.create({
        data: {
          status: "published",
          generatedAt,
          sourceRevision: validated.feed.source_revision,
          snapshotJson: validated
        }
      });
    }
  });

  if (validationFailure) {
    throw validationFailure;
  }

  return validated as FeedDocument;
}
