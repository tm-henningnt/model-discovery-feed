import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { exampleFeed } from "../feed/fixture";
import { fetchFeed, listModels, listRows, parseCliArgs, USAGE } from "./list";

describe("cli list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:30:00.000Z"));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.MODEL_FEED_API_KEY;
  });

  it("parses --help without throwing", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help", scope: "root" });
    expect(USAGE).toContain("model-feed [list] [options]");
  });

  it("sends If-None-Match and Authorization headers when supplied", async () => {
    process.env.MODEL_FEED_API_KEY = "env-token";

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(exampleFeed), {
        status: 200,
        headers: { ETag: '"next-etag"' }
      })
    );

    await fetchFeed("https://example.test/v1/feed", {
      etag: '"cached-etag"'
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("If-None-Match")).toBe('"cached-etag"');
    expect(headers.get("Authorization")).toBe("Bearer env-token");
  });

  it("returns the cached feed on 304 responses", async () => {
    const cachePath = await createCacheFile();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { ETag: '"cached-etag"' }
      })
    );

    const rows = await listModels({
      feedUrl: "https://example.test/v1/feed",
      json: true,
      cachePath
    });

    expect(rows).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("If-None-Match")).toBe('"cached-etag"');
  });

  it("creates nested cache directories before writing", async () => {
    const cachePath = await createNestedCachePath();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(exampleFeed), {
        status: 200,
        headers: { ETag: '"fresh-etag"' }
      })
    );

    await listModels({
      feedUrl: "https://example.test/v1/feed",
      json: true,
      cachePath
    });

    const cached = JSON.parse(await readFile(cachePath, "utf8")) as {
      etag: string | null;
    };
    expect(cached.etag).toBe('"fresh-etag"');
    expect(await readFile(cachePath, "utf8")).toContain('"feed"');
  });

  it("rejects non-positive minimum context token filters", () => {
    expect(() => parseCliArgs(["list", "--min-context-tokens", "0"])).toThrow(
      "Invalid numeric value for --min-context-tokens"
    );
    expect(() => parseCliArgs(["list", "--min-context-tokens", "-1"])).toThrow(
      "Invalid numeric value for --min-context-tokens"
    );
    expect(() => parseCliArgs(["list", "--min-context-tokens", "12.5"])).toThrow(
      "Invalid numeric value for --min-context-tokens"
    );
  });

  it("emits JSON-compatible records with pricing and source summaries", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(exampleFeed), {
        status: 200,
        headers: { ETag: '"fresh-etag"' }
      })
    );

    const rows = await listModels({
      feedUrl: "https://example.test/v1/feed",
      json: true
    });

    expect(rows).toEqual([
      {
        id: "openrouter:qwen/qwen3-coder:free",
        display_name: "Qwen3 Coder (free)",
        provider: { id: "openrouter", name: "OpenRouter" },
        endpoint: {
          protocol: "openai_chat_completions",
          base_url: "https://openrouter.ai/api/v1",
          model: "qwen/qwen3-coder:free"
        },
        capabilities: ["chat", "coding", "tool_use", "structured_output", "streaming"],
        context_tokens: 262144,
        pricing_kind: "free",
        pricing_explanation: "free via zero_priced_model",
        availability: "available",
        source_claims: [
          {
            source_type: "provider_api",
            source_url: "https://openrouter.ai/api/v1/models",
            observed_at: "2026-07-08T12:00:00.000Z",
            confidence: "high"
          }
        ]
      },
      {
        id: "groq:openai/gpt-oss-120b",
        display_name: "GPT OSS 120B",
        provider: { id: "groq", name: "Groq" },
        endpoint: {
          protocol: "openai_chat_completions",
          base_url: "https://api.groq.com/openai/v1",
          model: "openai/gpt-oss-120b"
        },
        capabilities: ["chat", "coding", "streaming"],
        context_tokens: 131072,
        pricing_kind: "unknown",
        pricing_explanation: "pricing is unknown or ambiguous",
        availability: "available",
        source_claims: [
          {
            source_type: "provider_api",
            source_url: "https://api.groq.com/openai/v1/models",
            observed_at: "2026-07-08T12:00:00.000Z",
            confidence: "medium"
          }
        ]
      }
    ]);
  });

  it("uses the supplied clock when explaining free pricing", () => {
    const rows = listRows(
      exampleFeed,
      { free: true, capability: "coding" },
      new Date("2026-07-08T12:30:00.000Z")
    );

    expect(rows[0]?.pricing_explanation).toBe("free via zero_priced_model");
  });

  it("uses the supplied clock when sorting free models", () => {
    const feed = structuredClone(exampleFeed);
    const baseFree = feed.models[0].pricing.free!;
    const staleAfterSeconds = 300;
    feed.models = [
      {
        ...feed.models[0],
        id: "zzz:example-free-model",
        display_name: "Zeta Free",
        provider_model_id: "zeta-free",
        canonical_model: { id: "zeta-free", confidence: "high" },
        pricing: {
          ...feed.models[0].pricing,
          free: {
            ...baseFree,
            last_verified_at: "2026-07-08T12:25:00.000Z"
          }
        },
        availability: {
          ...feed.models[0].availability,
          stale_after_seconds: staleAfterSeconds
        }
      },
      {
        ...feed.models[0],
        id: "aaa:example-free-model",
        display_name: "Alpha Free",
        provider_model_id: "alpha-free",
        canonical_model: { id: "alpha-free", confidence: "high" },
        pricing: {
          ...feed.models[0].pricing,
          free: {
            ...baseFree,
            last_verified_at: "2026-07-08T12:10:00.000Z"
          }
        },
        availability: {
          ...feed.models[0].availability,
          stale_after_seconds: staleAfterSeconds
        }
      }
    ];

    const rows = listRows(feed, { capability: "coding" }, new Date("2026-07-08T12:00:00.000Z"));

    expect(rows.map((row) => row.id)).toEqual(["aaa:example-free-model", "zzz:example-free-model"]);
  });

  it("matches the adapter output fixture for one free coding model", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(exampleFeed), {
        status: 200,
        headers: { ETag: '"fresh-etag"' }
      })
    );

    const rows = await listModels({
      feedUrl: "https://example.test/v1/feed",
      json: true,
      free: true,
      capability: "coding"
    });
    const adapterOutput = JSON.parse(
      await readFile(new URL("../../docs/public/fixtures/adapter-output.example.json", import.meta.url), "utf8")
    );

    expect(rows).toEqual(adapterOutput);
  });

  it("rejects 304 responses without a cache", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));

    await expect(
      listModels({
        feedUrl: "https://example.test/v1/feed",
        json: true,
        etag: '"cached-etag"'
      })
    ).rejects.toThrow("Feed returned 304 but no cached feed was available");
  });
});

async function createCacheFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "model-feed-cli-"));
  const cachePath = join(dir, "cache.json");
  await writeFile(cachePath, JSON.stringify({ etag: '"cached-etag"', feed: exampleFeed }), "utf8");
  await readFile(cachePath, "utf8");
  return cachePath;
}

async function createNestedCachePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "model-feed-cli-"));
  return join(dir, ".cache", "model-feed.json");
}
