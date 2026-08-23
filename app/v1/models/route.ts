import type { NextRequest } from "next/server";
import { filtersFromSearchParams, filterModels } from "@/feed/filter";
import { feedStore } from "@/feed/store";
import { requireFeedApiKey } from "@/server/auth";
import { cachedJsonResponse } from "@/server/http";

export async function GET(request: NextRequest) {
  const authFailure = requireFeedApiKey(request);
  if (authFailure) return authFailure;

  const feed = await feedStore.getFeed();
  const filters = filtersFromSearchParams(request.nextUrl.searchParams);
  return cachedJsonResponse(
    request,
    {
      object: "list",
      data: filterModels(feed, filters)
    },
    { generatedAt: feed.feed.generated_at }
  );
}
