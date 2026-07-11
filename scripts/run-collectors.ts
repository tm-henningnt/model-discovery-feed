import { validateFeedDocument } from "../src/feed/schema";
import { getFixtureFeed, mergeCollectorFeed, runCollectors } from "../src/collectors";
import { runCollectorsAndPublish, type PrismaPublishClient } from "../src/collectors/publish";
import { clearArtificialAnalysisEndpointScores } from "../src/enrichers/artificial-analysis";
import { enrichModels } from "../src/enrichers/pipeline";
import { getPrismaClient } from "../src/server/prisma";

async function main(): Promise<void> {
  const now = new Date();
  const publish = process.argv.includes("--publish");
  const context = {
    now,
    fetch,
    env: process.env
  };

  if (publish) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when using --publish");
    }

    const prisma = getPrismaClient();
    const validated = await runCollectorsAndPublish({
      context,
      prisma: prisma as unknown as PrismaPublishClient
    }).finally(async () => {
      await prisma.$disconnect();
    });

    process.stderr.write(
      `Published feed release ${validated.feed.source_revision} with ${validated.models.length} models.\n`
    );
    return;
  }

  const { providers, models, notices } = await runCollectors(context);
  const enriched = await enrichModels(models, context);
  const mergedFeed = mergeCollectorFeed(
    getFixtureFeed(),
    providers,
    enriched.models,
    [...notices, ...enriched.notices],
    now
  );
  const feed = {
    ...mergedFeed,
    models: mergedFeed.models.map(clearArtificialAnalysisEndpointScores)
  };
  const validated = validateFeedDocument(feed);

  process.stdout.write(`${JSON.stringify(validated, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
