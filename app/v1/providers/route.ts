import type { NextRequest } from "next/server";
import { filterProviders, providerFiltersFromSearchParams } from "@/feed/provider-filter";
import { feedStore } from "@/feed/store";
import { requireFeedApiKey } from "@/server/auth";
import { cachedJsonResponse } from "@/server/http";

export async function GET(request: NextRequest) {
  const authFailure = requireFeedApiKey(request);
  if (authFailure) return authFailure;

  const feed = await feedStore.getFeed();
  return cachedJsonResponse(
    request,
    {
      object: "list",
      data: filterProviders(feed, providerFiltersFromSearchParams(request.nextUrl.searchParams))
    },
    { generatedAt: feed.feed.generated_at }
  );
}
