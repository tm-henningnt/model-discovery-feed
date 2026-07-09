import type { ModelOffering } from "./schema";

export function hasStaleFreeClaim(model: ModelOffering, now = new Date()): boolean {
  if (!model.pricing.free) return false;
  const staleAfter = model.availability.stale_after_seconds ?? 43200;
  const verifiedAt = Date.parse(model.pricing.free.last_verified_at);
  if (Number.isNaN(verifiedAt)) return true;
  return now.getTime() - verifiedAt > staleAfter * 1000;
}

export function explainPricing(model: ModelOffering, now = new Date()): string {
  switch (model.pricing.kind) {
    case "free":
      return hasStaleFreeClaim(model, now)
        ? `free claim is stale; basis was ${model.pricing.free?.basis ?? "unknown"}`
        : `free via ${model.pricing.free?.basis ?? "unknown basis"}`;
    case "free_tier":
      return "free-tier allowance; usage may become paid after quota";
    case "trial":
      return "trial or promotional credit required";
    case "subscription_included":
      return "covered by a subscription or flat-rate plan";
    case "local":
      return "local runtime; provider billing does not apply";
    case "paid":
      return "paid offering";
    case "unknown":
      return "pricing is unknown or ambiguous";
    default:
      return "pricing is unknown or ambiguous";
  }
}
