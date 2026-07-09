import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { FeedDocument, ModelOffering, Provider } from "../feed/schema";
import { mergeCollectorFeed } from "./index";
import { runCollectorsAndPublish, type PrismaPublishClient, type PrismaPublishTransaction } from "./publish";
import type { Collector, CollectorContext, CollectorNotice } from "./types";

type FakeCollectorRun = {
  id: string;
  collector: string;
  status: string;
  startedAt: Date;
  finishedAt: Date;
  errorMessage: string | null;
};

type FakeSourceSnapshot = {
  id: string;
  sourceType: string;
  sourceUrl: string | null;
  collector: string;
  observedAt: Date;
  body: {
    provider: Provider;
    model_count: number;
    notices: CollectorNotice[];
    validation_error: string | null;
  };
  collectorRunId: string;
};

type FakeFeedRelease = {
  id: string;
  status: string;
  generatedAt: Date;
  sourceRevision: string;
  snapshotJson: FeedDocument;
};

function createContext(now: Date): CollectorContext {
  return {
    now,
    fetch,
    env: {}
  };
}

function cloneProvider(id: Provider["id"], name: string): Provider {
  return {
    ...structuredClone(exampleFeed.providers[0]),
    id,
    name
  };
}

function cloneModel(id: string, provider: Provider): ModelOffering {
  return {
    ...structuredClone(exampleFeed.models[0]),
    id,
    display_name: `${provider.name} Test Model`,
    provider: {
      id: provider.id,
      name: provider.name
    },
    provider_model_id: "test-model",
    canonical_model: {
      id: "test-model",
      confidence: "high"
    },
    endpoint: {
      ...structuredClone(exampleFeed.models[0].endpoint),
      model: "test-model"
    },
    source_claims: [
      {
        ...structuredClone(exampleFeed.models[0].source_claims[0]),
        id: `${id}:claim`,
        collector: provider.id,
        observed_at: "2026-07-08T12:00:00.000Z"
      }
    ]
  };
}

function createCollector(id: Collector["id"], provider: Provider, models: ModelOffering[], notices: CollectorNotice[] = []): Collector {
  return {
    id,
    async collect() {
      return {
        provider,
        models,
        notices
      };
    }
  };
}

function createFakePrisma(initialFeedReleases: FakeFeedRelease[] = []): PrismaPublishClient & {
  state: {
    collectorRuns: FakeCollectorRun[];
    sourceSnapshots: FakeSourceSnapshot[];
    feedReleases: FakeFeedRelease[];
  };
} {
  let nextId = 0;
  const state = {
    collectorRuns: [] as FakeCollectorRun[],
    sourceSnapshots: [] as FakeSourceSnapshot[],
    feedReleases: structuredClone(initialFeedReleases)
  };

  const transaction = async <T>(callback: (tx: PrismaPublishTransaction) => Promise<T>): Promise<T> => {
    const staged = {
      collectorRuns: structuredClone(state.collectorRuns),
      sourceSnapshots: structuredClone(state.sourceSnapshots),
      feedReleases: structuredClone(state.feedReleases)
    };
    const createId = (prefix: string) => `${prefix}-${++nextId}`;
    const tx: PrismaPublishTransaction = {
      collectorRun: {
        async create({ data }) {
          const record: FakeCollectorRun = {
            id: createId("collector-run"),
            ...data
          };
          staged.collectorRuns.push(record);
          return { id: record.id };
        }
      },
      sourceSnapshot: {
        async create({ data }) {
          const record: FakeSourceSnapshot = {
            id: createId("source-snapshot"),
            ...data
          };
          staged.sourceSnapshots.push(record);
          return record;
        }
      },
      feedRelease: {
        async create({ data }) {
          const record: FakeFeedRelease = {
            id: createId("feed-release"),
            ...data
          };
          staged.feedReleases.push(record);
          return record;
        }
      }
    };

    const result = await callback(tx);
    state.collectorRuns = staged.collectorRuns;
    state.sourceSnapshots = staged.sourceSnapshots;
    state.feedReleases = staged.feedReleases;
    return result;
  };

  return {
    $transaction: transaction,
    state
  };
}

describe("runCollectorsAndPublish", () => {
  it("updates expires_at relative to the supplied generatedAt", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");

    const merged = mergeCollectorFeed(structuredClone(exampleFeed), [], [], [], generatedAt);

    expect(merged.feed.generated_at).toBe("2026-07-08T18:30:00.000Z");
    expect(merged.feed.expires_at).toBe("2026-07-08T19:30:00.000Z");
    expect(merged.feed.expires_at).not.toBe(exampleFeed.feed.expires_at);
  });

  it("creates collector runs, source snapshots, and one published feed release", async () => {
    const now = new Date("2026-07-08T12:34:56.000Z");
    const openrouterProvider = cloneProvider("openrouter", "OpenRouter");
    const groqProvider = cloneProvider("groq", "Groq");
    const prisma = createFakePrisma();

    const published = await runCollectorsAndPublish({
      context: createContext(now),
      prisma,
      collectors: [
        createCollector("openrouter", openrouterProvider, [cloneModel("openrouter:test-model", openrouterProvider)]),
        createCollector("groq", groqProvider, [], [{ collector: "groq", message: "collector unavailable", status: 503 }])
      ]
    });

    expect(published.feed.source_revision).toBe("collector-run-2026-07-08T12:34:56.000Z");
    expect(prisma.state.collectorRuns).toHaveLength(2);
    expect(prisma.state.collectorRuns.map((run) => run.status)).toEqual([
      "completed",
      "completed_with_notices"
    ]);
    expect(prisma.state.sourceSnapshots).toHaveLength(2);
    expect(prisma.state.sourceSnapshots[0]?.body).toMatchObject({
      provider: { id: "openrouter" },
      model_count: 1,
      notices: []
    });
    expect(prisma.state.sourceSnapshots[1]?.body).toMatchObject({
      provider: { id: "groq" },
      model_count: 0,
      notices: [{ collector: "groq", message: "collector unavailable", status: 503 }]
    });
    expect(prisma.state.feedReleases).toHaveLength(1);
    expect(prisma.state.feedReleases[0]).toMatchObject({
      status: "published",
      sourceRevision: "collector-run-2026-07-08T12:34:56.000Z",
      snapshotJson: published
    });
  });

  it("creates no published release when feed validation fails", async () => {
    const now = new Date("2026-07-08T12:34:56.000Z");
    const provider = cloneProvider("openrouter", "OpenRouter");
    const invalidModel = {
      ...cloneModel("broken:model", provider),
      provider: {
        id: "missing-provider",
        name: "Missing Provider"
      }
    } satisfies ModelOffering;
    const prisma = createFakePrisma();

    await expect(
      runCollectorsAndPublish({
        context: createContext(now),
        prisma,
        collectors: [createCollector("openrouter", provider, [invalidModel])]
      })
    ).rejects.toThrow(/unknown provider id/);

    expect(prisma.state.collectorRuns).toHaveLength(1);
    expect(prisma.state.collectorRuns[0]).toMatchObject({
      collector: "openrouter",
      status: "completed",
      errorMessage: "feed validation failed: unknown provider id: missing-provider"
    });
    expect(prisma.state.sourceSnapshots).toHaveLength(1);
    expect(prisma.state.sourceSnapshots[0]?.body).toMatchObject({
      provider: { id: "openrouter" },
      model_count: 1,
      notices: [],
      validation_error: "feed validation failed: unknown provider id: missing-provider"
    });
    expect(prisma.state.feedReleases).toEqual([]);
  });

  it("does not replace a previous release with a notice-bearing collector result unless the merged feed validates", async () => {
    const now = new Date("2026-07-08T12:34:56.000Z");
    const provider = cloneProvider("gemini", "Gemini");
    const invalidModel = {
      ...cloneModel("broken:notice-model", provider),
      provider: {
        id: "missing-provider",
        name: "Missing Provider"
      }
    } satisfies ModelOffering;
    const previousRelease: FakeFeedRelease = {
      id: "existing-release",
      status: "published",
      generatedAt: new Date("2026-07-08T11:00:00.000Z"),
      sourceRevision: "collector-run-2026-07-08T11:00:00.000Z",
      snapshotJson: structuredClone(exampleFeed)
    };
    const prisma = createFakePrisma([previousRelease]);

    await expect(
      runCollectorsAndPublish({
        context: createContext(now),
        prisma,
        collectors: [
          createCollector("gemini", provider, [invalidModel], [
            { collector: "gemini", message: "partial collector failure", status: 502 }
          ])
        ]
      })
    ).rejects.toThrow(/unknown provider id/);

    expect(prisma.state.collectorRuns).toHaveLength(1);
    expect(prisma.state.collectorRuns[0]).toMatchObject({
      collector: "gemini",
      status: "completed_with_notices",
      errorMessage:
        "partial collector failure; feed validation failed: unknown provider id: missing-provider"
    });
    expect(prisma.state.sourceSnapshots).toHaveLength(1);
    expect(prisma.state.sourceSnapshots[0]?.body).toMatchObject({
      provider: { id: "gemini" },
      model_count: 1,
      notices: [{ collector: "gemini", message: "partial collector failure", status: 502 }],
      validation_error: "feed validation failed: unknown provider id: missing-provider"
    });
    expect(prisma.state.feedReleases).toEqual([previousRelease]);
  });
});
