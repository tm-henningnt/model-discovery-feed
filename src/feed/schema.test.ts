import Ajv from "ajv/dist/2020";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { hasStaleFreeClaim } from "./classification";
import { exampleFeed } from "./fixture";
import { feedJsonSchema } from "./json-schema";
import { validateFeedDocument } from "./schema";

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
ajv.addFormat("uri", {
  type: "string",
  validate(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
});
ajv.addFormat("date-time", {
  type: "string",
  validate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      return false;
    }

    return !Number.isNaN(Date.parse(value));
  }
});
ajv.addFormat("date", {
  type: "string",
  validate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
});
const validateFeedJsonSchema = ajv.compile(feedJsonSchema);
const publicFixturesUrl = new URL("../../docs/public/fixtures/", import.meta.url);

describe("feed schema", () => {
  const cloneExampleFeed = () => structuredClone(exampleFeed);

  it("validates the example feed fixture", () => {
    const feed = validateFeedDocument(exampleFeed);
    expect(feed.schema_version).toBe("1.0.0");
    expect(feed.models.length).toBeGreaterThan(0);
  });

  it("accepts a rich quality object in both schemas", () => {
    const rich = cloneExampleFeed();
    rich.models[0] = {
      ...rich.models[0],
      quality: {
        ...rich.models[0].quality,
        agentic_score: 45.6,
        benchmarks: {
          math_score: 62.1,
          ttft_seconds: 0.31,
          artificial_analysis: { mmlu_pro: 0.78, gpqa: 0.61 },
          design_arena: [
            { arena: "overall", category: "general", elo: 1123, rank: 14, win_rate: 0.52 }
          ]
        }
      }
    };

    expect(() => validateFeedDocument(rich)).not.toThrow();
    expect(validateFeedJsonSchema(rich)).toBe(true);
  });

  it("rejects negative TTFT values in both schemas", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      quality: {
        ...invalid.models[0].quality,
        benchmarks: { ttft_seconds: -0.01 }
      }
    };

    expect(() => validateFeedDocument(invalid)).toThrow(/greater than or equal to/i);
    expect(validateFeedJsonSchema(invalid)).toBe(false);
  });

  it("includes the required attributions on the fixture feed", () => {
    expect((exampleFeed as unknown as { attributions?: unknown }).attributions).toEqual([
      {
        source: "Artificial Analysis",
        url: "https://artificialanalysis.ai/",
        notice: "Model quality and performance scores by Artificial Analysis."
      },
      {
        source: "models.dev",
        url: "https://models.dev/",
        notice: "Model metadata from models.dev (MIT)."
      },
      {
        source: "Design Arena",
        url: "https://designarena.ai/",
        notice: "Design Arena Elo ratings."
      }
    ]);
  });

  it("rejects free offerings without free metadata", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      pricing: {
        ...invalid.models[0].pricing,
        kind: "free",
        free: null
      }
    };

    expect(() => validateFeedDocument(invalid)).toThrow(/pricing.kind=free/);
  });

  it("rejects models without source claims", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      source_claims: []
    };

    expect(() => validateFeedDocument(invalid)).toThrow(/at least one source claim/);
  });

  it("rejects profiles that select a missing model", () => {
    const invalid = cloneExampleFeed();
    invalid.profiles[0] = {
      ...invalid.profiles[0],
      selection: {
        ...invalid.profiles[0].selection,
        model_offering_id: "missing:model"
      }
    };

    expect(() => validateFeedDocument(invalid)).toThrow(/unknown model id/);
  });

  it("rejects models that reference a missing provider", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      provider: {
        ...invalid.models[0].provider,
        id: "missing-provider"
      }
    };

    expect(() => validateFeedDocument(invalid)).toThrow(/unknown provider id/);
  });

  it("rejects duplicate model ids", () => {
    const invalid = cloneExampleFeed();
    invalid.models[1] = {
      ...invalid.models[1],
      id: invalid.models[0].id
    };

    expect(() => validateFeedDocument(invalid)).toThrow(/duplicate model id/);
  });

  it("allows unknown fields for forward compatibility", () => {
    const extended = {
      ...exampleFeed,
      future_top_level: true,
      models: [
        {
          ...exampleFeed.models[0],
          future_model_field: "ok"
        }
      ]
    };

    expect(validateFeedDocument(extended).models[0]).toMatchObject({
      future_model_field: "ok"
    });
  });

  it("keeps plan_editions typed while every provider's own subscription keys stay legal", () => {
    const feed = cloneExampleFeed();
    // The three subscription shapes the collectors emit today: QwenCloud Token Plan, ClinePass,
    // and OpenCode Zen. Each carries keys the contract does not name.
    feed.models[0].pricing.kind = "subscription_included";
    feed.models[0].pricing.free = null;
    feed.models[0].pricing.subscription = {
      billing: "flat_monthly",
      per_token_billed: false,
      reference_pricing: false,
      credits_metered: true,
      interactive_use_only: true,
      quota_multiplier_vs_payg: "2-5x",
      plan_editions: ["personal", "team"]
    };

    const validated = validateFeedDocument(feed);
    expect(validated.models[0].pricing.subscription?.plan_editions).toEqual(["personal", "team"]);
    expect(validated.models[0].pricing.subscription?.quota_multiplier_vs_payg).toBe("2-5x");
    expect(validateFeedJsonSchema(feed)).toBe(true);
  });

  it("rejects a non-string plan edition", () => {
    const feed = cloneExampleFeed();
    feed.models[0].pricing.subscription = { plan_editions: [7 as never] };

    expect(() => validateFeedDocument(feed)).toThrow();
    expect(validateFeedJsonSchema(feed)).toBe(false);
  });

  it("validates the example feed against the published JSON Schema", () => {
    expect(validateFeedJsonSchema(cloneExampleFeed())).toBe(true);
  });

  it("accepts null provider signup.required in the published JSON Schema", () => {
    const extended = cloneExampleFeed();
    extended.providers[0] = {
      ...extended.providers[0],
      signup: {
        ...extended.providers[0].signup,
        required: null
      }
    };

    expect(validateFeedJsonSchema(extended)).toBe(true);
  });

  it("rejects free offerings without free metadata in the published JSON Schema", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      pricing: {
        ...invalid.models[0].pricing,
        kind: "free",
        free: null
      }
    };

    expect(validateFeedJsonSchema(invalid)).toBe(false);
  });

  it("rejects empty source claim field_paths in the published JSON Schema", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      source_claims: [
        {
          ...invalid.models[0].source_claims[0],
          field_paths: []
        }
      ]
    };

    expect(validateFeedJsonSchema(invalid)).toBe(false);
  });

  it("rejects invalid provider URLs in the published JSON Schema", () => {
    const invalid = cloneExampleFeed();
    invalid.providers[0] = {
      ...invalid.providers[0],
      homepage: "not a url"
    };

    expect(validateFeedJsonSchema(invalid)).toBe(false);
  });

  it("rejects empty source claim field path strings in the published JSON Schema", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      source_claims: [
        {
          ...invalid.models[0].source_claims[0],
          field_paths: [""]
        }
      ]
    };

    expect(validateFeedJsonSchema(invalid)).toBe(false);
  });

  it("rejects invalid endpoint protocols in the published JSON Schema", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      endpoint: {
        ...invalid.models[0].endpoint,
        protocol: "invalid_protocol" as never
      }
    };

    expect(validateFeedJsonSchema(invalid)).toBe(false);
  });

  it("rejects invalid pricing kinds in the published JSON Schema", () => {
    const invalid = cloneExampleFeed();
    invalid.models[0] = {
      ...invalid.models[0],
      pricing: {
        ...invalid.models[0].pricing,
        kind: "invalid_kind" as never
      }
    };

    expect(validateFeedJsonSchema(invalid)).toBe(false);
  });

  it("allows unknown fields in the published JSON Schema for forward compatibility", () => {
    const extended = {
      ...cloneExampleFeed(),
      future_top_level: true,
      models: [
        {
          ...exampleFeed.models[0],
          future_model_field: "ok"
        }
      ]
    };

    expect(validateFeedJsonSchema(extended)).toBe(true);
  });

  it("validates a feed document without response_envelope_key", () => {
    const feed = cloneExampleFeed();
    feed.models[0] = {
      ...feed.models[0],
      endpoint: {
        ...feed.models[0].endpoint,
        protocol_options: undefined
      }
    };

    expect(() => validateFeedDocument(feed)).not.toThrow();
    expect(validateFeedJsonSchema(feed)).toBe(true);
  });

  it("validates a feed document with response_envelope_key", () => {
    const feed = cloneExampleFeed();
    feed.models[0] = {
      ...feed.models[0],
      endpoint: {
        ...feed.models[0].endpoint,
        protocol_options: {
          response_envelope_key: "data"
        }
      }
    };

    expect(() => validateFeedDocument(feed)).not.toThrow();
    expect(validateFeedJsonSchema(feed)).toBe(true);
  });

  it("validates with unknown keys in protocol_options (permissiveness preserved)", () => {
    const feed = cloneExampleFeed();
    feed.models[0] = {
      ...feed.models[0],
      endpoint: {
        ...feed.models[0].endpoint,
        protocol_options: {
          response_envelope_key: "data",
          future_option_key: "unknown_value",
          another_future_key: 123
        }
      }
    };

    expect(() => validateFeedDocument(feed)).not.toThrow();
    expect(validateFeedJsonSchema(feed)).toBe(true);
  });

  it("validates the public conformance feed fixtures", async () => {
    const validFeed = await readPublicFixture("valid-feed.json");
    const staleFreeFeed = await readPublicFixture("stale-free-feed.json");
    const encodedIdFeed = await readPublicFixture("encoded-id-feed.json");

    const validatedValidFeed = validateFeedDocument(validFeed);
    const validatedStaleFreeFeed = validateFeedDocument(staleFreeFeed);
    const validatedEncodedIdFeed = validateFeedDocument(encodedIdFeed);

    expect(validatedValidFeed).toHaveProperty("future_feed_field", "tolerated");
    expect(validatedValidFeed.models[0]).toHaveProperty("future_model_field", "tolerated");
    expect(validateFeedJsonSchema(validFeed)).toBe(true);

    expect(
      hasStaleFreeClaim(validatedStaleFreeFeed.models[0], new Date("2026-07-08T12:00:00.000Z"))
    ).toBe(true);
    expect(validateFeedJsonSchema(staleFreeFeed)).toBe(true);

    expect(validatedEncodedIdFeed.models[0].id).toContain("/");
    expect(encodeURIComponent(validatedEncodedIdFeed.models[0].id)).not.toBe(
      validatedEncodedIdFeed.models[0].id
    );
    expect(validateFeedJsonSchema(encodedIdFeed)).toBe(true);
  });

  it.each([
    ["feed", (feed: typeof exampleFeed) => delete (feed.feed as Record<string, unknown>).expires_at],
    [
      "provider.homepage",
      (feed: typeof exampleFeed) => delete (feed.providers[0] as Record<string, unknown>).homepage
    ],
    [
      "provider.default_base_url",
      (feed: typeof exampleFeed) => delete (feed.providers[0] as Record<string, unknown>).default_base_url
    ],
    [
      "source_claim.source_url",
      (feed: typeof exampleFeed) =>
        delete (feed.models[0].source_claims[0] as Record<string, unknown>).source_url
    ],
    [
      "source_claim.raw_reference",
      (feed: typeof exampleFeed) =>
        delete (feed.models[0].source_claims[0] as Record<string, unknown>).raw_reference
    ],
    [
      "model_offering.canonical_model",
      (feed: typeof exampleFeed) => delete (feed.models[0] as Record<string, unknown>).canonical_model
    ],
    [
      "model_offering.description",
      (feed: typeof exampleFeed) => delete (feed.models[0] as Record<string, unknown>).description
    ],
    [
      "model_offering.quality",
      (feed: typeof exampleFeed) => delete (feed.models[0] as Record<string, unknown>).quality
    ],
    [
      "profile.description",
      (feed: typeof exampleFeed) => delete (feed.profiles[0] as Record<string, unknown>).description
    ]
  ])("rejects missing %s in the published JSON Schema", (_, mutate) => {
    const invalid = cloneExampleFeed();
    mutate(invalid);

    expect(validateFeedJsonSchema(invalid)).toBe(false);
  });
});

async function readPublicFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, publicFixturesUrl), "utf8")) as unknown;
}
