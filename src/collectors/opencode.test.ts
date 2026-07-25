import { describe, expect, it } from "vitest";
import { opencodeGoCollector, opencodeZenCollector } from "./opencode";
import type { CollectorContext } from "./types";

const goResponse = {
  object: "list",
  data: [
    { id: "kimi-k2.7-code", object: "model", created: 1783892556, owned_by: "opencode" },
    { id: "glm-5.2", object: "model", created: 1783892556, owned_by: "opencode" }
  ]
};

const zenResponse = {
  object: "list",
  data: [
    { id: "claude-opus-4-8", object: "model", created: 1783892557, owned_by: "opencode" },
    { id: "gpt-5.6-sol", object: "model", created: 1783892557, owned_by: "opencode" }
  ]
};

function createContext(overrides: {
  env?: Record<string, string | undefined>;
  onRequest?: (url: string, init: RequestInit | undefined) => void;
  status?: number;
  body?: unknown;
}): CollectorContext {
  const fakeFetch: typeof fetch = async (input, init) => {
    overrides.onRequest?.(String(input), init);
    const status = overrides.status ?? 200;
    return new Response(JSON.stringify(overrides.body ?? goResponse), {
      status,
      headers: { "content-type": "application/json" }
    });
  };

  return {
    now: new Date("2026-07-12T00:00:00.000Z"),
    fetch: fakeFetch,
    env: overrides.env ?? {}
  };
}

describe("opencodeGoCollector", () => {
  it("requests the OpenCode Go models endpoint", async () => {
    let requestedUrl: string | null = null;
    await opencodeGoCollector.collect(
      createContext({ onRequest: (url) => (requestedUrl = url) })
    );

    expect(requestedUrl).toBe("https://opencode.ai/zen/go/v1/models");
  });

  it("sends the OPENCODE_API_KEY as a bearer token when present", async () => {
    let authorization: string | null = null;
    await opencodeGoCollector.collect(
      createContext({
        env: { OPENCODE_API_KEY: "oc_test_key" },
        onRequest: (_url, init) => {
          authorization = new Headers(init?.headers).get("authorization");
        }
      })
    );

    expect(authorization).toBe("Bearer oc_test_key");
  });

  it("normalizes every model and derives reasoning capabilities from the id", async () => {
    const result = await opencodeGoCollector.collect(createContext({ body: goResponse }));

    expect(result.models.map((model) => model.id)).toEqual([
      "opencode-go:kimi-k2.7-code",
      "opencode-go:glm-5.2"
    ]);
    expect(result.notices).toEqual([]);

    const kimi = result.models.find((model) => model.id === "opencode-go:kimi-k2.7-code");
    expect(kimi?.provider.id).toBe("opencode-go");
    expect(kimi?.capabilities).toEqual(expect.arrayContaining(["chat", "streaming", "tool_use"]));
    // ADR 0009: `coding` is no longer inferred here. It moved to the
    // derive-coding-capability pipeline stage — see derive-coding-capability.test.ts.
    expect(kimi?.capabilities).not.toContain("coding");
    expect(kimi?.pricing.kind).toBe("subscription_included");
    expect(kimi?.pricing.subscription).toMatchObject({
      billing: "flat_monthly",
      per_token_billed: false,
      reference_pricing: true
    });
    expect(kimi?.endpoint.base_url).toBe("https://opencode.ai/zen/go/v1");
  });

  it("reports a notice when the request fails", async () => {
    const result = await opencodeGoCollector.collect(
      createContext({ status: 500, body: { error: "boom" } })
    );

    expect(result.models).toEqual([]);
    expect(result.notices).toEqual([
      expect.objectContaining({ collector: "opencode-go", message: "collector unavailable", status: 500 })
    ]);
  });
});

describe("opencodeZenCollector", () => {
  it("requests the OpenCode Zen models endpoint and namespaces ids", async () => {
    let requestedUrl: string | null = null;
    const result = await opencodeZenCollector.collect(
      createContext({ body: zenResponse, onRequest: (url) => (requestedUrl = url) })
    );

    expect(requestedUrl).toBe("https://opencode.ai/zen/v1/models");
    expect(result.models.map((model) => model.id)).toEqual([
      "opencode-zen:claude-opus-4-8",
      "opencode-zen:gpt-5.6-sol"
    ]);
    expect(result.provider.name).toBe("OpenCode Zen");
    const claude = result.models.find((model) => model.id === "opencode-zen:claude-opus-4-8");
    expect(claude?.pricing.kind).toBe("unknown");
    expect(claude?.pricing.subscription).toBeUndefined();
  });
});
