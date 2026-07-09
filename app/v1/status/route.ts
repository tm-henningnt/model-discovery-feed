import type { NextRequest } from "next/server";
import { feedStore } from "@/feed/store";
import { requireFeedApiKey } from "@/server/auth";
import { jsonResponse } from "@/server/http";
import { buildStatus } from "@/server/status";

export async function GET(request: NextRequest) {
  const authFailure = requireFeedApiKey(request);
  if (authFailure) return authFailure;

  const feed = await feedStore.getFeed();
  return jsonResponse(buildStatus(feed), {
    headers: {
      "Cache-Control": "private, max-age=60"
    }
  });
}
