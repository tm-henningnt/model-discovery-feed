import { hasStaleFreeClaim } from "./classification";
import type { FeedDocument, ModelOffering } from "./schema";

const preferredPricing = new Map([
  ["free", 6],
  ["free_tier", 5],
  ["subscription_included", 4],
  ["trial", 3],
  ["local", 2],
  ["paid", 1],
  ["unknown", 0]
]);

export function isFreeClaimFresh(model: ModelOffering, now = new Date()): boolean {
  return !!model.pricing.free && !hasStaleFreeClaim(model, now);
}

export function compareForBestFreeCoder(a: ModelOffering, b: ModelOffering, now = new Date()): number {
  return (
    scoreAvailability(b) - scoreAvailability(a) ||
    Number(isPreferredOverStaleFreeClaim(b, now)) - Number(isPreferredOverStaleFreeClaim(a, now)) ||
    (preferredPricing.get(b.pricing.kind) ?? 0) - (preferredPricing.get(a.pricing.kind) ?? 0) ||
    Number(b.capabilities.includes("coding")) - Number(a.capabilities.includes("coding")) ||
    Number(b.capabilities.includes("tool_use")) - Number(a.capabilities.includes("tool_use")) ||
    Number(b.capabilities.includes("structured_output")) - Number(a.capabilities.includes("structured_output")) ||
    (b.limits.context_tokens ?? 0) - (a.limits.context_tokens ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

export function selectBestFreeCoder(feed: FeedDocument, now = new Date()): ModelOffering | undefined {
  return feed.models
    .filter((model) => model.policy.visibility === "listed")
    .filter((model) => model.capabilities.includes("coding"))
    .filter((model) => ["free", "free_tier", "subscription_included", "trial", "local"].includes(model.pricing.kind))
    .sort((a, b) => compareForBestFreeCoder(a, b, now))[0];
}

function scoreAvailability(model: ModelOffering): number {
  if (model.availability.status === "available") return 2;
  if (model.availability.status === "limited") return 1;
  return 0;
}

function isPreferredOverStaleFreeClaim(model: ModelOffering, now = new Date()): boolean {
  return model.pricing.kind !== "free" || !hasStaleFreeClaim(model, now);
}
