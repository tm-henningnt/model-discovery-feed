import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

/** How long a client may reuse a feed-derived response before it revalidates. */
const FEED_CACHE_CONTROL = "private, max-age=300";

/**
 * Serialize a JSON body compactly. The `/v1` routes are a machine contract, and indentation is a
 * third of the bytes on the largest of them: `/v1/models` serves 8.9 MB pretty-printed and 5.9 MB
 * compact. A reader who wants it indented pipes the response through `jq`.
 */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return serializedJsonResponse(JSON.stringify(body), init);
}

/** `jsonResponse` for a body already serialized, so a caller never stringifies the same body twice. */
export function serializedJsonResponse(serialized: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(serialized, {
    ...init,
    headers
  });
}

/**
 * A feed-derived JSON response that a client can revalidate instead of re-downloading.
 *
 * The ETag is the digest of the exact bytes served, so it identifies one filtered result rather than
 * the whole release. Two callers asking `/v1/models` with different filters get different validators,
 * and a caller repeating its own request gets a 304.
 */
export function cachedJsonResponse(
  request: NextRequest,
  body: unknown,
  options: { generatedAt: string; cacheControl?: string }
): Response {
  const serialized = JSON.stringify(body);
  const headers = new Headers();
  headers.set("ETag", makeEtag(serialized));
  headers.set("Cache-Control", options.cacheControl ?? FEED_CACHE_CONTROL);

  const generatedAt = new Date(options.generatedAt);
  if (!Number.isNaN(generatedAt.getTime())) {
    headers.set("Last-Modified", generatedAt.toUTCString());
  }

  return maybeNotModified(request, headers) ?? serializedJsonResponse(serialized, { headers });
}

export function maybeNotModified(request: NextRequest, headers: Headers): Response | undefined {
  const ifNoneMatch = request.headers.get("if-none-match");
  const etag = headers.get("ETag");
  if (ifNoneMatch && etag && matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return undefined;
}

function matchesIfNoneMatch(ifNoneMatch: string, etag: string): boolean {
  const validators = ifNoneMatch.split(",").map((validator) => validator.trim());
  if (validators.includes("*")) return true;

  const normalizedEtag = etag.replace(/^W\//, "");
  return validators.some((validator) => {
    if (!validator) return false;
    return validator.replace(/^W\//, "") === normalizedEtag;
  });
}

export function makeEtag(body: string): string {
  return `"${createHash("sha256").update(body).digest("base64url")}"`;
}
