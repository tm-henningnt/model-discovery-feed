import type { NextRequest } from "next/server";
import { feedStore } from "@/feed/store";
import { requireFeedApiKey } from "@/server/auth";
import { jsonResponse } from "@/server/http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const authFailure = requireFeedApiKey(_request);
  if (authFailure) return authFailure;

  const { id } = await context.params;
  const feed = await feedStore.getFeed();
  const decodedId = decodeURIComponent(id);
  const model = feed.models.find((candidate) => candidate.id === decodedId);

  if (!model) {
    return jsonResponse({ error: "model_not_found", id: decodedId }, { status: 404 });
  }

  return jsonResponse(model);
}
