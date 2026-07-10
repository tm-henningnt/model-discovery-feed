import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { FEED_KEY_COOKIE, requireFeedApiKey, verifyFeedApiKey } from "./auth";

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

  it("allows a matching key in the mdf_key cookie when no header is present", () => {
    process.env.MODEL_FEED_API_KEY_SHA256 = sha256("secret");
    const request = new NextRequest("https://example.com/v1/feed", {
      headers: { cookie: `${FEED_KEY_COOKIE}=secret` }
    });

    expect(requireFeedApiKey(request)).toBeNull();
  });

  it("rejects an incorrect key in the mdf_key cookie", () => {
    process.env.MODEL_FEED_API_KEY_SHA256 = sha256("secret");
    const request = new NextRequest("https://example.com/v1/feed", {
      headers: { cookie: `${FEED_KEY_COOKIE}=wrong` }
    });

    expect(requireFeedApiKey(request)?.status).toBe(401);
  });

  it("prefers a valid bearer header over a garbage cookie", () => {
    process.env.MODEL_FEED_API_KEY_SHA256 = sha256("secret");
    const request = new NextRequest("https://example.com/v1/feed", {
      headers: {
        authorization: "Bearer secret",
        cookie: `${FEED_KEY_COOKIE}=garbage`
      }
    });

    expect(requireFeedApiKey(request)).toBeNull();
  });
});

describe("verifyFeedApiKey", () => {
  it("returns true for a correct key", () => {
    expect(verifyFeedApiKey("secret", sha256("secret"))).toBe(true);
  });

  it("returns false for a wrong key", () => {
    expect(verifyFeedApiKey("wrong", sha256("secret"))).toBe(false);
  });

  it("returns false, without throwing, for a malformed odd-length expected hash", () => {
    expect(() => verifyFeedApiKey("secret", "abc")).not.toThrow();
    expect(verifyFeedApiKey("secret", "abc")).toBe(false);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
