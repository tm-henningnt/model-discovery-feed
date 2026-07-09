import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { jsonResponse, makeEtag, maybeNotModified } from "./http";

describe("HTTP helpers", () => {
  it("produces stable strong etags", () => {
    expect(makeEtag("same body")).toBe(makeEtag("same body"));
    expect(makeEtag("same body")).not.toBe(makeEtag("different body"));
  });

  it("preserves supplied headers on json responses", () => {
    const headers = new Headers();
    headers.set("ETag", '"abc"');
    headers.set("Last-Modified", "Wed, 08 Jul 2026 12:00:00 GMT");
    headers.set("Cache-Control", "private, max-age=300");

    const response = jsonResponse({ ok: true }, { headers });

    expect(response.headers.get("ETag")).toBe('"abc"');
    expect(response.headers.get("Last-Modified")).toBe("Wed, 08 Jul 2026 12:00:00 GMT");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("matches weak if-none-match validators", () => {
    const headers = new Headers({ ETag: '"abc"' });
    const request = new NextRequest("https://example.com", {
      headers: { "If-None-Match": 'W/"abc"' }
    });

    const response = maybeNotModified(request, headers);

    expect(response?.status).toBe(304);
    expect(response?.headers.get("ETag")).toBe('"abc"');
  });

  it("matches comma-separated if-none-match validators", () => {
    const headers = new Headers({ ETag: '"abc"' });
    const request = new NextRequest("https://example.com", {
      headers: { "If-None-Match": '"other", W/"abc", "third"' }
    });

    const response = maybeNotModified(request, headers);

    expect(response?.status).toBe(304);
    expect(response?.headers.get("ETag")).toBe('"abc"');
  });
});
