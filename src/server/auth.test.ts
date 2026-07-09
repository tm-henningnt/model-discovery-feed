import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { requireFeedApiKey } from "./auth";

describe("requireFeedApiKey", () => {
  afterEach(() => {
    delete process.env.MODEL_FEED_API_KEY_SHA256;
  });

  it("allows requests when no feed API key hash is configured", () => {
    const request = new NextRequest("https://example.com/v1/feed");
    expect(requireFeedApiKey(request)).toBeNull();
  });

  it("rejects missing or incorrect bearer tokens when configured", () => {
    process.env.MODEL_FEED_API_KEY_SHA256 = sha256("secret");
    const request = new NextRequest("https://example.com/v1/feed", {
      headers: { authorization: "Bearer wrong" }
    });

    expect(requireFeedApiKey(request)?.status).toBe(401);
  });

  it("allows a matching bearer token", () => {
    process.env.MODEL_FEED_API_KEY_SHA256 = sha256("secret");
    const request = new NextRequest("https://example.com/v1/feed", {
      headers: { authorization: "Bearer secret" }
    });

    expect(requireFeedApiKey(request)).toBeNull();
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
