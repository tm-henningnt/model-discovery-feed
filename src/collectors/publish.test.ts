import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { FeedDocument, ModelOffering, Provider } from "../feed/schema";
import { validateFeedDocument } from "../feed/schema";
import { mergeCollectorFeed } from "./index";
import { runCollectorsAndPublish, type PrismaPublishClient } from "./publish";
import type { Collector, CollectorContext, CollectorNotice } from "./types";
import {
  ARTIFICIAL_ANALYSIS_COLLECTOR_ID,
  ARTIFICIAL_ANALYSIS_SNAPSHOT_TYPE,
  type ArtificialAnalysisResponse
} from "../enrichers/artificial-analysis";
import { MODELS_DEV_API_URL } from "../enrichers/models-dev";

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
  body:
    | {
        provider: Provider;
        model_count: number;
        notices: CollectorNotice[];
        validation_error: string | null;
      }
    | Record<string, unknown>;
  collectorRunId: string;
};

type FakeFeedRelease = {
  id: string;
  status: string;
  generatedAt: Date;
  sourceRevision: string;
  snapshotJson: FeedDocument;
};

function createContext(
  now: Date,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = {}
): CollectorContext {
  return {
    now,
    fetch: async (input, init) =>
      String(input) === MODELS_DEV_API_URL
        ? new Response("{}", { status: 200 })
        : fetchImpl(input, init),
    env
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
      confidence: "high",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
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

function createFakePrisma(
  initialFeedReleases: FakeFeedRelease[] = [],
  initialSourceSnapshots: FakeSourceSnapshot[] = []
): PrismaPublishClient & {
  state: {
    collectorRuns: FakeCollectorRun[];
    sourceSnapshots: FakeSourceSnapshot[];
    feedReleases: FakeFeedRelease[];
  };
} {
  let nextId = 0;
  const state = {
    collectorRuns: [] as FakeCollectorRun[],
    sourceSnapshots: structuredClone(initialSourceSnapshots),
    feedReleases: structuredClone(initialFeedReleases)
  };

  const createId = (prefix: string) => `${prefix}-${++nextId}`;

  return {
    collectorRun: {
      async createManyAndReturn({ data }) {
        return data.map((row) => {
          const record: FakeCollectorRun = {
            id: createId("collector-run"),
            ...row
          };
          state.collectorRuns.push(record);
          return { id: record.id, collector: record.collector };
        });
      }
    },
    sourceSnapshot: {
      async createMany({ data }) {
        for (const row of data) {
          state.sourceSnapshots.push({
            id: createId("source-snapshot"),
            ...row
          });
        }
        return { count: data.length };
      },
      async findFirst({ where }) {
        return state.sourceSnapshots
          .filter(
            (snapshot) =>
              snapshot.collector === where.collector && snapshot.sourceType === where.sourceType
          )
          .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0] ?? null;
      }
    },
    feedRelease: {
      async create({ data }) {
        const record: FakeFeedRelease = {
          id: createId("feed-release"),
          ...data
        };
        state.feedReleases.push(record);
        return record;
      },
      async findFirst({ where }) {
        return (
          state.feedReleases
            .filter((release) => release.status === where.status)
            .sort((left, right) => right.generatedAt.getTime() - left.generatedAt.getTime())[0] ?? null
        );
      }
    },
    state
  };
}

const artificialAnalysisPayload: ArtificialAnalysisResponse = {
  status: "success",
  data: [
    {
      id: "aa-gpt-oss-120b",
      name: "gpt-oss-120b (low)",
      slug: "gpt-oss-120b-low",
      model_creator: { id: "openai", name: "OpenAI", slug: "openai" },
      evaluations: {
        artificial_analysis_intelligence_index: 63.25,
        artificial_analysis_coding_index: 72.75,
        artificial_analysis_math_index: 81.5,
        mmlu_pro: 77.1
      },
      median_output_tokens_per_second: 500,
      median_time_to_first_token_seconds: 0.12
    }
  ]
};

function artificialAnalysisModel(provider: Provider): ModelOffering {
  const model = cloneModel(`${provider.id}:openai/gpt-oss-120b`, provider);
  model.display_name = "GPT OSS 120B";
  model.provider_model_id = "openai/gpt-oss-120b";
  model.canonical_model = {
    id: "openai/gpt-oss-120b",
    confidence: "high",
    knowledge_cutoff: null,
    release_date: null,
    open_weights: null
  };
  model.endpoint.model = "openai/gpt-oss-120b";
  model.quality = {
    coding_score: null,
    reasoning_score: null,
    agentic_score: null,
    speed_score: null,
    benchmarks: {
      math_score: null,
      ttft_seconds: null,
      artificial_analysis: null,
      design_arena: null
    },
    recommendation_notes: []
  };
  return model;
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

  it("persists the raw Artificial Analysis response in publish mode", async () => {
    const now = new Date("2026-07-11T12:34:56.000Z");
    const openrouterProvider = cloneProvider("openrouter", "OpenRouter");
    const groqProvider = cloneProvider("groq", "Groq");
    const aaFetch: typeof fetch = async () =>
      new Response(JSON.stringify(artificialAnalysisPayload), { status: 200 });
    const prisma = createFakePrisma();

    const published = await runCollectorsAndPublish({
      context: createContext(now, aaFetch, { ARTIFICIALANALYSIS_API_KEY: "aa_test_key" }),
      prisma,
      collectors: [
        createCollector("openrouter", openrouterProvider, [artificialAnalysisModel(openrouterProvider)]),
        createCollector("groq", groqProvider, [artificialAnalysisModel(groqProvider)])
      ]
    });

    expect(prisma.state.collectorRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ collector: ARTIFICIAL_ANALYSIS_COLLECTOR_ID, status: "completed" })
    ]));
    expect(prisma.state.sourceSnapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collector: ARTIFICIAL_ANALYSIS_COLLECTOR_ID,
        sourceType: ARTIFICIAL_ANALYSIS_SNAPSHOT_TYPE,
        observedAt: now,
        body: artificialAnalysisPayload
      })
    ]));
    expect(published.models.find((model) => model.id === "groq:openai/gpt-oss-120b")?.quality).toMatchObject({
      coding_score: 72.75,
      reasoning_score: 63.25,
      speed_score: null,
      benchmarks: { math_score: 81.5, ttft_seconds: null }
    });
    expect(
      published.models
        .find((model) => model.id === "groq:openai/gpt-oss-120b")
        ?.source_claims.find((item) => item.field_paths.includes("quality.coding_score"))
    ).toMatchObject({
      collector: "score-propagation",
      source_url: "https://artificialanalysis.ai/",
      confidence: "medium",
      raw_reference: {
        canonical_model_id: "openai/gpt-oss-120b",
        donor_offering_id: "openrouter:openai/gpt-oss-120b",
        donor_claim_id: "artificial-analysis:openrouter:openai/gpt-oss-120b:0",
        donor_raw_reference: expect.any(Object)
      }
    });
    expect(published.models.every((model) => model.quality.speed_score === null)).toBe(true);
    expect(
      published.models.every(
        (model) => model.quality.benchmarks !== null && model.quality.benchmarks.ttft_seconds === null
      )
    ).toBe(true);
  });

  it("loads the latest persisted AA snapshot after a publish-mode fetch failure", async () => {
    const now = new Date("2026-07-20T12:34:56.000Z");
    const snapshotObservedAt = new Date("2026-07-11T12:34:56.000Z");
    const openrouterProvider = cloneProvider("openrouter", "OpenRouter");
    const groqProvider = cloneProvider("groq", "Groq");
    const failedFetch: typeof fetch = async () => new Response("upstream unavailable", { status: 503 });
    const existingSnapshot: FakeSourceSnapshot = {
      id: "aa-snapshot-existing",
      sourceType: ARTIFICIAL_ANALYSIS_SNAPSHOT_TYPE,
      sourceUrl: "https://artificialanalysis.ai/api/v2/data/llms/models",
      collector: ARTIFICIAL_ANALYSIS_COLLECTOR_ID,
      observedAt: snapshotObservedAt,
      body: artificialAnalysisPayload as Record<string, unknown>,
      collectorRunId: "aa-run-existing"
    };
    const prisma = createFakePrisma([], [existingSnapshot]);

    const published = await runCollectorsAndPublish({
      context: createContext(now, failedFetch, { ARTIFICIALANALYSIS_API_KEY: "aa_test_key" }),
      prisma,
      collectors: [
        createCollector("openrouter", openrouterProvider, [artificialAnalysisModel(openrouterProvider)]),
        createCollector("groq", groqProvider, [artificialAnalysisModel(groqProvider)])
      ]
    });

    const model = published.models.find((candidate) => candidate.id === "groq:openai/gpt-oss-120b");
    expect(model?.quality.coding_score).toBe(72.75);
    expect(model?.source_claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collector: "score-propagation",
        observed_at: snapshotObservedAt.toISOString(),
        raw_reference: expect.objectContaining({
          canonical_model_id: "openai/gpt-oss-120b",
          donor_offering_id: "openrouter:openai/gpt-oss-120b"
        })
      })
    ]));
    expect(published.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "Artificial Analysis API unavailable", used_snapshot: true }),
      expect.objectContaining({ message: "Artificial Analysis snapshot is more than 7 days old" })
    ]));
    expect(prisma.state.sourceSnapshots).toHaveLength(3);
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

  it("excludes models from the base feed that are not in the collector list", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");
    const baseFeedWithFixtureModel = structuredClone(exampleFeed);
    const newProvider = cloneProvider("new-provider", "New Provider");
    const newModel = cloneModel("new-provider:new-model", newProvider);

    const merged = mergeCollectorFeed(
      baseFeedWithFixtureModel,
      [newProvider],
      [newModel],
      [],
      generatedAt
    );

    expect(merged.models).toHaveLength(1);
    expect(merged.models[0]).toMatchObject({
      id: "new-provider:new-model",
      provider: { id: "new-provider" }
    });
    expect(merged.models.find((m) => m.id === "openrouter:qwen/qwen3-coder:free")).toBeUndefined();
  });

  it("excludes providers from the base feed that are not in the collector list", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");
    const baseFeedWithFixtureProviders = structuredClone(exampleFeed);
    const newProvider = cloneProvider("new-provider", "New Provider");
    const newModel = cloneModel("new-provider:new-model", newProvider);

    const merged = mergeCollectorFeed(
      baseFeedWithFixtureProviders,
      [newProvider],
      [newModel],
      [],
      generatedAt
    );

    expect(merged.providers).toHaveLength(1);
    expect(merged.providers[0]).toMatchObject({
      id: "new-provider",
      name: "New Provider"
    });
    expect(merged.providers.find((p) => p.id === "openrouter")).toBeUndefined();
    expect(merged.providers.find((p) => p.id === "groq")).toBeUndefined();
  });

  it("uses the collector's version when both base feed and collector contain the same model", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");
    const baseFeed = structuredClone(exampleFeed);
    const fixtureModel = baseFeed.models[0]!;

    const collectorProvider = cloneProvider(fixtureModel.provider.id, fixtureModel.provider.name);
    const collectorModel = {
      ...structuredClone(fixtureModel),
      display_name: "Updated Display Name from Collector"
    };

    const merged = mergeCollectorFeed(
      baseFeed,
      [collectorProvider],
      [collectorModel],
      [],
      generatedAt
    );

    const mergedModel = merged.models.find((m) => m.id === fixtureModel.id);
    expect(mergedModel).toBeDefined();
    expect(mergedModel?.display_name).toBe("Updated Display Name from Collector");
  });

  it("preserves base feed schema_version, attributions, and default_stale_after_seconds", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");
    const baseFeed = structuredClone(exampleFeed);
    const newProvider = cloneProvider("test-provider", "Test Provider");
    const newModel = cloneModel("test-provider:test-model", newProvider);

    const merged = mergeCollectorFeed(
      baseFeed,
      [newProvider],
      [newModel],
      [],
      generatedAt
    );

    expect(merged.schema_version).toBe(baseFeed.schema_version);
    expect(merged.attributions).toEqual(baseFeed.attributions);
    expect(merged.feed.default_stale_after_seconds).toBe(baseFeed.feed.default_stale_after_seconds);
  });

  it("produces a valid feed document when merged with collector-supplied models matching profiles", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");
    const baseFeed = structuredClone(exampleFeed);
    const fixtureProvider = baseFeed.providers[0]!;
    const fixtureModel = baseFeed.models[0]!;

    const merged = mergeCollectorFeed(
      baseFeed,
      [fixtureProvider],
      [fixtureModel],
      [],
      generatedAt
    );

    expect(() => validateFeedDocument(merged)).not.toThrow();
    expect(merged.models).toHaveLength(1);
    expect(merged.providers).toHaveLength(1);
  });

  it("keeps the first of two offerings sharing an id and records the collision", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");
    const baseFeed = structuredClone(exampleFeed);
    const provider = cloneProvider("dup-provider", "Dup Provider");
    const first = cloneModel("dup-provider:same-id", provider);
    const second = cloneModel("dup-provider:same-id", provider);
    first.pricing = { ...first.pricing, kind: "paid" };
    second.pricing = { ...second.pricing, kind: "free" };

    const merged = mergeCollectorFeed(baseFeed, [provider], [first, second], [], generatedAt);

    // Cline's catalog really does list one model twice with conflicting
    // pricing. Last-write-wins would let an upstream reordering publish a paid
    // model as free.
    expect(merged.models).toHaveLength(1);
    expect(merged.models[0]!.pricing.kind).toBe("paid");
    expect(merged.notices).toContainEqual(
      expect.objectContaining({
        collector: "feed-merge",
        message: "duplicate offering id: kept the first, discarded the rest",
        model_offering_id: "dup-provider:same-id",
        kept_pricing_kind: "paid",
        discarded_pricing_kind: "free"
      })
    );
  });

  it("drops a base-feed profile whose selected offering is not in the collector output", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");
    const baseFeed = structuredClone(exampleFeed);
    const selectedId = baseFeed.profiles[0]!.selection.model_offering_id;
    const newProvider = cloneProvider("new-provider", "New Provider");
    const newModel = cloneModel("new-provider:new-model", newProvider);

    const merged = mergeCollectorFeed(baseFeed, [newProvider], [newModel], [], generatedAt);

    // The fixture profile selects a fixture offering that no collector produces.
    // Carrying it over would fail the schema's cross-object invariant.
    expect(baseFeed.profiles).not.toHaveLength(0);
    expect(merged.models.some((model) => model.id === selectedId)).toBe(false);
    expect(merged.profiles).toHaveLength(0);
    expect(() => validateFeedDocument(merged)).not.toThrow();
    expect(merged.notices).toContainEqual(
      expect.objectContaining({
        collector: "feed-merge",
        message: "profile dropped: selected offering not in collector output",
        model_offering_id: selectedId
      })
    );
  });

  it("keeps a base-feed profile whose selected offering is in the collector output", () => {
    const generatedAt = new Date("2026-07-08T18:30:00.000Z");
    const baseFeed = structuredClone(exampleFeed);
    const fixtureProvider = baseFeed.providers[0]!;
    const fixtureModel = baseFeed.models.find(
      (model) => model.id === baseFeed.profiles[0]!.selection.model_offering_id
    )!;

    const merged = mergeCollectorFeed(baseFeed, [fixtureProvider], [fixtureModel], [], generatedAt);

    expect(merged.profiles).toHaveLength(baseFeed.profiles.length);
    expect(() => validateFeedDocument(merged)).not.toThrow();
  });
});

describe("runCollectorsAndPublish availability lifecycle (ADR 0008)", () => {
  it("carries an offering that disappeared from the collector output forward as unknown, using the previous published release as baseline", async () => {
    const previousNow = new Date("2026-07-24T03:17:00.000Z");
    const now = new Date("2026-07-25T03:17:00.000Z");
    const openrouterProvider = cloneProvider("openrouter", "OpenRouter");

    const survivorPrevious = cloneModel("openrouter:survivor", openrouterProvider);
    survivorPrevious.availability = {
      status: "available",
      last_checked_at: previousNow.toISOString(),
      last_success_at: previousNow.toISOString(),
      stale_after_seconds: 86400
    };
    const goneModel = cloneModel("openrouter:gone", openrouterProvider);
    goneModel.availability = {
      status: "available",
      last_checked_at: previousNow.toISOString(),
      last_success_at: previousNow.toISOString(),
      stale_after_seconds: 86400
    };

    const previousFeed = validateFeedDocument({
      ...structuredClone(exampleFeed),
      providers: [openrouterProvider],
      models: [survivorPrevious, goneModel],
      profiles: []
    });

    const prisma = createFakePrisma([
      {
        id: "feed-release-seed",
        status: "published",
        generatedAt: previousNow,
        sourceRevision: "collector-run-seed",
        snapshotJson: previousFeed
      }
    ]);

    const survivorCurrent = cloneModel("openrouter:survivor", openrouterProvider);

    const published = await runCollectorsAndPublish({
      context: createContext(now),
      prisma,
      collectors: [createCollector("openrouter", openrouterProvider, [survivorCurrent])]
    });

    const survivor = published.models.find((model) => model.id === "openrouter:survivor");
    const gone = published.models.find((model) => model.id === "openrouter:gone");

    expect(survivor?.availability.status).toBe("available");
    expect(survivor?.availability.last_success_at).toBe(now.toISOString());
    expect(gone?.availability.status).toBe("unknown");
    expect(gone?.availability.last_checked_at).toBe(now.toISOString());
    expect(gone?.availability.last_success_at).toBe(previousNow.toISOString());
    expect(gone?.policy.visibility).toBe("listed");
  });
});
