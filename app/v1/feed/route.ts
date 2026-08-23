import type { NextRequest } from "next/server";
import { feedStore } from "@/feed/store";
import { requireFeedApiKey } from "@/server/auth";
import { cachedJsonResponse } from "@/server/http";

export async function GET(request: NextRequest) {
  const authFailure = requireFeedApiKey(request);
  if (authFailure) return authFailure;

  const feed = await feedStore.getFeed();
  return cachedJsonResponse(request, feed, { generatedAt: feed.feed.generated_at });
}
