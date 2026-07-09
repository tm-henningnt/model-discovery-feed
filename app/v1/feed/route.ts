import type { NextRequest } from "next/server";
import { feedStore } from "@/feed/store";
import { requireFeedApiKey } from "@/server/auth";
import { feedSnapshotHeaders, jsonResponse, maybeNotModified } from "@/server/http";

export async function GET(request: NextRequest) {
  const authFailure = requireFeedApiKey(request);
  if (authFailure) return authFailure;

  const feed = await feedStore.getFeed();
  const headers = feedSnapshotHeaders(feed);
  const notModified = maybeNotModified(request, headers);
  if (notModified) return notModified;
  return jsonResponse(feed, { headers });
}
