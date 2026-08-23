import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { cachedJsonResponse, jsonResponse, makeEtag, maybeNotModified } from "./http";

const GENERATED_AT = "2026-07-08T12:00:00.000Z";

function requestWith(ifNoneMatch?: string): NextRequest {
  return new NextRequest("https://example.com", {
    headers: ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}
  });
}

describe("HTTP helpers", () => {
  it("produces stable strong etags", () => {
    expect(makeEtag("same body")).toBe(makeEtag("same body"));
    expect(makeEtag("same body")).not.toBe(makeEtag("different body"));
  });

  it("serializes a json body without indentation", async () => {
    const response = jsonResponse({ object: "list", data: [1, 2] });

    expect(await response.text()).toBe('{"object":"list","data":[1,2]}');
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
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

    const response = maybeNotModified(requestWith('W/"abc"'), headers);

    expect(response?.status).toBe(304);
    expect(response?.headers.get("ETag")).toBe('"abc"');
  });

  it("matches comma-separated if-none-match validators", () => {
    const headers = new Headers({ ETag: '"abc"' });

    const response = maybeNotModified(requestWith('"other", W/"abc", "third"'), headers);

    expect(response?.status).toBe(304);
    expect(response?.headers.get("ETag")).toBe('"abc"');
  });
});

describe("cachedJsonResponse", () => {
  it("tags the response with a digest of the bytes it serves", async () => {
    const body = { object: "list", data: [{ id: "a" }] };
    const response = cachedJsonResponse(requestWith(), body, { generatedAt: GENERATED_AT });
    const served = await response.text();

    expect(response.status).toBe(200);
    expect(served).toBe(JSON.stringify(body));
    expect(response.headers.get("ETag")).toBe(makeEtag(served));
    expect(response.headers.get("Last-Modified")).toBe("Wed, 08 Jul 2026 12:00:00 GMT");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("answers 304 with no body when the client already holds the etag", async () => {
    const body = { object: "list", data: [{ id: "a" }] };
    const etag = cachedJsonResponse(requestWith(), body, { generatedAt: GENERATED_AT }).headers.get("ETag");

    const response = cachedJsonResponse(requestWith(etag ?? ""), body, { generatedAt: GENERATED_AT });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("ETag")).toBe(etag);
  });

  it("gives two different filtered results two different etags", () => {
    const all = cachedJsonResponse(requestWith(), { object: "list", data: [{ id: "a" }, { id: "b" }] }, {
      generatedAt: GENERATED_AT
    });
    const filtered = cachedJsonResponse(requestWith(), { object: "list", data: [{ id: "a" }] }, {
      generatedAt: GENERATED_AT
    });

    expect(all.headers.get("ETag")).not.toBe(filtered.headers.get("ETag"));
  });

  it("serves a filtered body rather than 304 when the client holds another filter's etag", () => {
    const otherEtag = cachedJsonResponse(requestWith(), { object: "list", data: [{ id: "b" }] }, {
      generatedAt: GENERATED_AT
    }).headers.get("ETag");

    const response = cachedJsonResponse(requestWith(otherEtag ?? ""), { object: "list", data: [{ id: "a" }] }, {
      generatedAt: GENERATED_AT
    });

    expect(response.status).toBe(200);
  });

  it("accepts a cache-control override and omits an unparseable Last-Modified", () => {
    const response = cachedJsonResponse(requestWith(), { ok: true }, {
      generatedAt: "not-a-date",
      cacheControl: "public, max-age=3600"
    });

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Last-Modified")).toBeNull();
  });
});
