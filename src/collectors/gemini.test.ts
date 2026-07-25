import { describe, expect, it } from "vitest";
import { geminiCollector } from "./gemini";
import type { CollectorContext } from "./types";

function page1Response(): unknown {
  return {
    models: [
      { name: "models/gemini-3-flash", baseModelId: "gemini-3-flash", displayName: "Gemini 3 Flash" }
    ],
    nextPageToken: "page-2"
  };
}

function createContext(fetchImpl: typeof fetch): CollectorContext {
  return { now: new Date("2026-07-25T00:00:00.000Z"), fetch: fetchImpl, env: {} };
}

describe("geminiCollector", () => {
  it("emits a collector-unavailable notice and keeps the partial roster when pagination fails mid-run", async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify(page1Response()), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("server error", { status: 503 });
    };

    const result = await geminiCollector.collect(createContext(fetchImpl));

    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.id).toBe("gemini:gemini-3-flash");

    const notice = result.notices.find((n) => typeof n.message === "string" && (n.message as string).startsWith("collector unavailable"));
    expect(notice).toBeDefined();
    expect(notice?.collector).toBe("gemini");
    expect(notice?.pages_succeeded).toBe(1);
  });

  it("returns models with no notice when every page succeeds", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ models: [{ name: "models/gemini-3-flash", baseModelId: "gemini-3-flash" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

    const result = await geminiCollector.collect(createContext(fetchImpl));

    expect(result.models).toHaveLength(1);
    expect(result.notices).toEqual([]);
  });

  it("emits the fallback notice when the very first page fails, with zero models", async () => {
    const fetchImpl: typeof fetch = async () => new Response("boom", { status: 500 });

    const result = await geminiCollector.collect(createContext(fetchImpl));

    expect(result.models).toEqual([]);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]?.message).toMatch(/^collector unavailable/);
  });
});
