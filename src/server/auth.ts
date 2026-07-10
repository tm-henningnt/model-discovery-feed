import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

export const FEED_KEY_COOKIE = "mdf_key";

export function verifyFeedApiKey(provided: string, expectedHash: string): boolean {
  const actualHash = createHash("sha256").update(provided).digest("hex");
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function requireFeedApiKey(request: NextRequest): Response | null {
  const expectedHash = process.env.MODEL_FEED_API_KEY_SHA256;
  if (!expectedHash) return null;

  const provided = extractBearerToken(request) ?? request.cookies.get(FEED_KEY_COOKIE)?.value;
  if (!provided) return unauthorized();

  if (!verifyFeedApiKey(provided, expectedHash)) {
    return unauthorized();
  }

  return null;
}

function extractBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "www-authenticate": "Bearer"
    }
  });
}
