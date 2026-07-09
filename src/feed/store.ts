import { exampleFeed } from "./fixture";
import { applyManualOverrides, type ManualOverrideInput } from "./overrides";
import { validateFeedDocument, type FeedDocument } from "./schema";
import { getPrismaClient } from "@/server/prisma";

type PublishedFeedRelease = {
  snapshotJson: unknown;
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

export type FeedStore = {
  getFeed(): Promise<FeedDocument>;
};

export class FixtureFeedStore implements FeedStore {
  async getFeed(): Promise<FeedDocument> {
    return validateFeedDocument(exampleFeed);
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

      throw new Error("Failed to load published feed release");
    }
  }
}

export const feedStore: FeedStore = new OptionalPrismaFeedStore();
