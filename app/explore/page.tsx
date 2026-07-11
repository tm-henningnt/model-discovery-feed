import type { Metadata } from "next";
import { Suspense } from "react";
import { loadFeed } from "../lib/feed-data";
import { Explorer } from "./Explorer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore the feed",
  description:
    "Search and filter every model offering in the feed by provider, capability, pricing, and availability."
};

export default async function ExplorePage() {
  const { feed, status, usingFixture } = await loadFeed();
  const listed = feed.models.filter((m) => m.policy.visibility === "listed");

  return (
    <Suspense fallback={null}>
      <Explorer
        models={listed}
        providers={feed.providers}
        attributions={feed.attributions}
        generatedAt={status.generated_at}
        stale={status.stale}
        usingFixture={usingFixture}
        nowMs={Date.now()}
      />
    </Suspense>
  );
}
