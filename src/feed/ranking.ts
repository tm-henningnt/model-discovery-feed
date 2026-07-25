import { hasStaleFreeClaim, isConfidentlyFree } from "./classification";
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

export const DELEGATION_PROFILE_IDS = [
  "best-free-coder",
  "best-coder",
  "best-agentic",
  "best-value-coder"
] as const;

export type DelegationProfileId = (typeof DELEGATION_PROFILE_IDS)[number];

export function isFreeClaimFresh(model: ModelOffering, now = new Date()): boolean {
  return !!model.pricing.free && !hasStaleFreeClaim(model, now);
}

export function blendedPricePer1M(model: ModelOffering, now = new Date()): number {
  if (isConfidentlyFree(model, now)) return 0;

  const { input_usd_per_1m_tokens: input, output_usd_per_1m_tokens: output } = model.pricing;
  if (input === null || output === null) return Number.POSITIVE_INFINITY;

  return 0.75 * input + 0.25 * output;
}

export function compareRecommended(a: ModelOffering, b: ModelOffering, now = new Date()): number {
  return (
    scoreAvailability(b) - scoreAvailability(a) ||
    compareNullableNumbersDescending(a.quality.reasoning_score, b.quality.reasoning_score) ||
    compareNullableNumbersDescending(a.quality.coding_score, b.quality.coding_score) ||
    blendedPricePer1M(a, now) - blendedPricePer1M(b, now) ||
    (b.limits.context_tokens ?? 0) - (a.limits.context_tokens ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

export function compareForBestFreeCoder(a: ModelOffering, b: ModelOffering, now = new Date()): number {
  return (
    scoreAvailability(b) - scoreAvailability(a) ||
    Number(isPreferredOverStaleFreeClaim(b, now)) - Number(isPreferredOverStaleFreeClaim(a, now)) ||
    (preferredPricing.get(b.pricing.kind) ?? 0) - (preferredPricing.get(a.pricing.kind) ?? 0) ||
    compareNullableNumbersDescending(a.quality.coding_score, b.quality.coding_score) ||
    Number(b.capabilities.includes("tool_use")) - Number(a.capabilities.includes("tool_use")) ||
    Number(b.capabilities.includes("structured_output")) - Number(a.capabilities.includes("structured_output")) ||
    (b.limits.context_tokens ?? 0) - (a.limits.context_tokens ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

function predicateForBestFreeCoder(model: ModelOffering): boolean {
  return (
    model.capabilities.includes("coding") &&
    ["free", "free_tier", "subscription_included", "trial", "local"].includes(model.pricing.kind)
  );
}

export function compareForBestCoder(a: ModelOffering, b: ModelOffering, now = new Date()): number {
  return (
    compareNullableNumbersDescending(a.quality.coding_score, b.quality.coding_score) ||
    blendedPricePer1M(a, now) - blendedPricePer1M(b, now) ||
    a.id.localeCompare(b.id)
  );
}

function predicateForBestCoder(model: ModelOffering): boolean {
  return model.capabilities.includes("tool_use") && model.quality.coding_score !== null;
}

export function compareForBestAgentic(a: ModelOffering, b: ModelOffering, _now = new Date()): number {
  return compareNullableNumbersDescending(a.quality.agentic_score, b.quality.agentic_score) || a.id.localeCompare(b.id);
}

function predicateForBestAgentic(model: ModelOffering): boolean {
  return (
    model.capabilities.includes("tool_use") &&
    model.capabilities.includes("structured_output") &&
    model.quality.agentic_score !== null
  );
}

export function compareForBestValueCoder(a: ModelOffering, b: ModelOffering, now = new Date()): number {
  return compareNullableNumbersDescending(valueScore(a, now), valueScore(b, now)) || a.id.localeCompare(b.id);
}

function predicateForBestValueCoder(model: ModelOffering): boolean {
  return (
    model.pricing.kind === "paid" &&
    model.pricing.input_usd_per_1m_tokens !== null &&
    model.pricing.output_usd_per_1m_tokens !== null &&
    model.quality.coding_score !== null
  );
}

type ProfileRule = {
  predicate: (model: ModelOffering) => boolean;
  compare: (a: ModelOffering, b: ModelOffering, now: Date) => number;
};

const DELEGATION_PROFILE_RULES: Record<DelegationProfileId, ProfileRule> = {
  "best-free-coder": { predicate: predicateForBestFreeCoder, compare: compareForBestFreeCoder },
  "best-coder": { predicate: predicateForBestCoder, compare: compareForBestCoder },
  "best-agentic": { predicate: predicateForBestAgentic, compare: compareForBestAgentic },
  "best-value-coder": { predicate: predicateForBestValueCoder, compare: compareForBestValueCoder }
};

function makeSelector(profileId: DelegationProfileId) {
  return (feed: FeedDocument, now = new Date()): ModelOffering | undefined =>
    rankByProfile(feed.models, profileId, now)[0];
}

export const selectBestFreeCoder = makeSelector("best-free-coder");
export const selectBestCoder = makeSelector("best-coder");
export const selectBestAgentic = makeSelector("best-agentic");
export const selectBestValueCoder = makeSelector("best-value-coder");

function isDelegationProfileId(value: string): value is DelegationProfileId {
  return (DELEGATION_PROFILE_IDS as readonly string[]).includes(value);
}

/**
 * Filters and orders an arbitrary model list (e.g. the explorer's current
 * selection) by a named delegation profile's inclusion rule and comparator.
 * Unlike selectDelegationProfile, this returns every qualifying offering in
 * rank order rather than only the winner — the shape an export or a
 * multi-candidate consumer wants. Unknown profile ids yield an empty list.
 */
export function rankByProfile(models: ModelOffering[], profileId: string, now = new Date()): ModelOffering[] {
  if (!isDelegationProfileId(profileId)) {
    return [];
  }

  const rule = DELEGATION_PROFILE_RULES[profileId];
  return models
    .filter((model) => model.policy.visibility === "listed")
    .filter(rule.predicate)
    .sort((a, b) => rule.compare(a, b, now));
}

export function selectDelegationProfile(
  feed: FeedDocument,
  profileId: string,
  now = new Date()
): ModelOffering | undefined {
  return rankByProfile(feed.models, profileId, now)[0];
}

function scoreAvailability(model: ModelOffering): number {
  if (model.availability.status === "available") return 2;
  if (model.availability.status === "limited" || model.availability.status === "deprecated") return 1;
  return 0;
}

function isPreferredOverStaleFreeClaim(model: ModelOffering, now = new Date()): boolean {
  return model.pricing.kind !== "free" || !hasStaleFreeClaim(model, now);
}

/**
 * Orders a nullable numeric field descending, with unavailable values after
 * every known value. Consumers that expose feed scores should use this rather
 * than recreating null ordering in their own layer.
 */
export function compareNullableNumbersDescending(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

function valueScore(model: ModelOffering, now: Date): number | null {
  if (
    model.pricing.kind !== "paid" ||
    model.pricing.input_usd_per_1m_tokens === null ||
    model.pricing.output_usd_per_1m_tokens === null ||
    model.quality.coding_score === null
  ) {
    return null;
  }

  const price = blendedPricePer1M(model, now);
  return price > 0 ? model.quality.coding_score / price : null;
}
