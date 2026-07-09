import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { FeedDocument } from "@/feed/schema";

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers
  });
}

export function feedSnapshotHeaders(feed: FeedDocument): Headers {
  const body = JSON.stringify(feed);
  const headers = new Headers();
  headers.set("ETag", makeEtag(body));
  headers.set("Last-Modified", new Date(feed.feed.generated_at).toUTCString());
  headers.set("Cache-Control", "private, max-age=300");
  return headers;
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
