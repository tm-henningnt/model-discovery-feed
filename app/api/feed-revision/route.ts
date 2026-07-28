import { jsonResponse } from "@/server/http";
import { loadFeedRevision } from "../../lib/feed-data";

export const dynamic = "force-dynamic";

/**
 * Report which release the site serves. The browser polls this to find out that
 * a collector run published a new one.
 *
 * This route belongs to the website, not to the `/v1` contract. API clients read
 * `/v1/status`, which answers the same question with counts and collector health.
 * The route needs no key check of its own: `proxy.ts` gates every path outside
 * `/v1`, so a deployment with `MODEL_FEED_API_KEY_SHA256` set already requires
 * the session cookie here.
 */
export async function GET() {
  const load = await loadFeedRevision();
  const headers = { "Cache-Control": "no-store" };

  if (!load.ok) {
    return jsonResponse({ error: "feed_revision_unavailable" }, { status: 503, headers });
  }

  return jsonResponse(
    {
      generated_at: load.revision.generatedAt,
      source_revision: load.revision.sourceRevision
    },
    { headers }
  );
}
