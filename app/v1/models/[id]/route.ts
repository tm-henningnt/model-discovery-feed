import type { NextRequest } from "next/server";
import { feedStore } from "@/feed/store";
import { requireFeedApiKey } from "@/server/auth";
import { cachedJsonResponse, jsonResponse } from "@/server/http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const authFailure = requireFeedApiKey(request);
  if (authFailure) return authFailure;

  const { id } = await context.params;
  const feed = await feedStore.getFeed();
  const decodedId = decodeURIComponent(id);
  const model = feed.models.find((candidate) => candidate.id === decodedId);

  if (!model) {
    // A miss is not cached: the next release can add the id.
    return jsonResponse({ error: "model_not_found", id: decodedId }, { status: 404 });
  }

  return cachedJsonResponse(request, model, { generatedAt: feed.feed.generated_at });
}
