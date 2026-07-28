import { exampleFeed } from "./fixture";
import { applyManualOverrides, type ManualOverrideInput } from "./overrides";
import { validateFeedDocument, type FeedDocument } from "./schema";
import { getPrismaClient } from "@/server/prisma";

/**
 * Describe an error for the logs without leaking a secret. Database errors can
 * quote the connection string, so remove credentials and query strings.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "non-error thrown";
  const message = error.message
    .replace(/([a-z+]+:\/\/)[^\s@/]*@/gi, "$1<redacted>@")
    .replace(/([?&](api_key|apikey|password|sslcert)=)[^&\s]*/gi, "$1<redacted>");
  return `${error.name}: ${message}`;
}

/**
 * A published release row. Every column is optional because the two reads below
 * select different ones: the feed read takes the snapshot, and the revision read
 * takes the two identity columns.
 */
type PublishedFeedRelease = {
  snapshotJson?: unknown;
  generatedAt?: Date;
  sourceRevision?: string;
};

type PrismaFeedReader = {
  feedRelease: {
    findFirst(args: {
      where: {
        status: "published";
      };
      orderBy: {
        generatedAt: "desc";
      };
      select?: {
        generatedAt: true;
        sourceRevision: true;
      };
    }): Promise<PublishedFeedRelease | null>;
  };
  manualOverride: {
    findMany(args: {
      where: {
        expiresAt: {
          gt: Date;
        };
      };
      orderBy: {
        createdAt: "asc";
      };
    }): Promise<
      Array<{
        targetFieldPath: string;
        value: unknown;
        reason: string;
        operator: string;
        sourceUrl: string | null;
        visibleInSourceClaims: boolean;
        expiresAt: Date;
        createdAt: Date;
      }>
    >;
  };
};

/** Which release a reader is looking at, without the release itself. */
export type FeedRevision = {
  /** ISO-8601 timestamp, from `feed.generated_at`. */
  generatedAt: string;
  sourceRevision: string;
};

export type FeedStore = {
  getFeed(): Promise<FeedDocument>;
  /**
   * Read the identity of the current release without its snapshot.
   *
   * The website polls this to find out that a collector run published a new
   * release. `getFeed` answers the same question, but it transfers the whole
   * snapshot and validates it against the schema. That cost per poll is not
   * acceptable, so this reads two columns instead.
   */
  getRevision(): Promise<FeedRevision>;
};

export class FixtureFeedStore implements FeedStore {
  async getFeed(): Promise<FeedDocument> {
    return validateFeedDocument(exampleFeed);
  }

  async getRevision(): Promise<FeedRevision> {
    return {
      generatedAt: exampleFeed.feed.generated_at,
      sourceRevision: exampleFeed.feed.source_revision
    };
  }
}

export class OptionalPrismaFeedStore implements FeedStore {
  private lastKnownGoodFeed: FeedDocument | null = null;

  constructor(
    private readonly fallback: FeedStore = new FixtureFeedStore(),
    private readonly prisma: PrismaFeedReader | null = null
  ) {}

  async getFeed(): Promise<FeedDocument> {
    if (process.env.MODEL_FEED_USE_DATABASE !== "true" || !process.env.DATABASE_URL) {
      return this.fallback.getFeed();
    }

    try {
      const prisma = this.prisma ?? (getPrismaClient() as unknown as PrismaFeedReader);
      const release = await prisma.feedRelease.findFirst({
        where: { status: "published" },
        orderBy: { generatedAt: "desc" }
      });

      if (!release) {
        throw new Error("No published feed release found");
      }

      const overrides = await prisma.manualOverride.findMany({
        where: {
          expiresAt: {
            gt: new Date()
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      });

      const feed = validateFeedDocument(
        applyManualOverrides(
          validateFeedDocument(release.snapshotJson),
          overrides.map((override): ManualOverrideInput => ({
            targetFieldPath: override.targetFieldPath,
            value: override.value,
            reason: override.reason,
            operator: override.operator,
            sourceUrl: override.sourceUrl,
            visibleInSourceClaims: override.visibleInSourceClaims,
            expiresAt: override.expiresAt.toISOString(),
            createdAt: override.createdAt.toISOString()
          }))
        )
      );
      this.lastKnownGoodFeed = feed;
      return feed;
    } catch (error) {
      if (this.lastKnownGoodFeed) {
        console.warn("Using last-known-good database feed after database read failed.");
        return this.lastKnownGoodFeed;
      }

      if (error instanceof Error && error.message === "No published feed release found") {
        throw error;
      }

      // Log the underlying fault. Without it the real cause, such as a rejected
      // connection string, is invisible in the runtime logs.
      console.error(`Failed to load published feed release. ${describeError(error)}`);
      throw new Error("Failed to load published feed release", { cause: error });
    }
  }

  async getRevision(): Promise<FeedRevision> {
    if (process.env.MODEL_FEED_USE_DATABASE !== "true" || !process.env.DATABASE_URL) {
      return this.fallback.getRevision();
    }

    try {
      const prisma = this.prisma ?? (getPrismaClient() as unknown as PrismaFeedReader);
      const release = await prisma.feedRelease.findFirst({
        where: { status: "published" },
        orderBy: { generatedAt: "desc" },
        select: { generatedAt: true, sourceRevision: true }
      });

      if (!release?.generatedAt || !release.sourceRevision) {
        throw new Error("No published feed release found");
      }

      return {
        generatedAt: release.generatedAt.toISOString(),
        sourceRevision: release.sourceRevision
      };
    } catch (error) {
      if (error instanceof Error && error.message === "No published feed release found") {
        throw error;
      }

      // A failed read must not report a revision. A guess here would either hide
      // a new release or announce one that does not exist.
      console.error(`Failed to read the published feed revision. ${describeError(error)}`);
      throw new Error("Failed to read the published feed revision", { cause: error });
    }
  }
}

export const feedStore: FeedStore = new OptionalPrismaFeedStore();
