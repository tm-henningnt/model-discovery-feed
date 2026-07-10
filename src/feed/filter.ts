import { isConfidentlyFree } from "./classification";
import type { FeedDocument, ModelOffering, PricingKind } from "./schema";

export type ModelFilters = {
  free?: boolean;
  pricingKind?: PricingKind;
  provider?: string;
  capability?: string;
  capabilities?: string[];
  protocol?: string;
  openaiCompatible?: boolean;
  minContextTokens?: number;
  requiresCreditCard?: boolean;
  requiresApiKey?: boolean;
  available?: boolean;
  profile?: string;
  q?: string;
};

export function filtersFromSearchParams(params: URLSearchParams): ModelFilters {
  return {
    free: parseBoolean(params.get("free")),
    pricingKind: params.get("pricing_kind") as PricingKind | undefined,
    provider: params.get("provider") ?? undefined,
    capability: params.get("capability") ?? undefined,
    capabilities: params.get("capabilities")?.split(",").filter(Boolean),
    protocol: params.get("protocol") ?? undefined,
    openaiCompatible: parseBoolean(params.get("openai_compatible")),
    minContextTokens: parseNumber(params.get("min_context_tokens")),
    requiresCreditCard: parseBoolean(params.get("requires_credit_card")),
    requiresApiKey: parseBoolean(params.get("requires_api_key")),
    available: parseBoolean(params.get("available")),
    profile: params.get("profile") ?? undefined,
    q: params.get("q") ?? undefined
  };
}

export function filterModels(feed: FeedDocument, filters: ModelFilters, now = new Date()): ModelOffering[] {
  const profileOfferingId = filters.profile
    ? feed.profiles.find((profile) => profile.id === filters.profile)?.selection.model_offering_id
    : undefined;

  return feed.models.filter((model) => {
    if (filters.free !== undefined) {
      if (isConfidentlyFree(model, now) !== filters.free) return false;
    }

    if (filters.pricingKind && model.pricing.kind !== filters.pricingKind) return false;
    if (filters.provider && model.provider.id !== filters.provider) return false;
    if (filters.capability && !model.capabilities.includes(filters.capability as never)) return false;
    if (filters.capabilities?.some((capability) => !model.capabilities.includes(capability as never))) {
      return false;
    }
    if (filters.protocol && model.endpoint.protocol !== filters.protocol) return false;
    if (filters.openaiCompatible !== undefined) {
      const compatible = model.endpoint.protocol === "openai_chat_completions" || model.endpoint.protocol === "openai_responses";
      if (compatible !== filters.openaiCompatible) return false;
    }
    if (filters.minContextTokens !== undefined) {
      if ((model.limits.context_tokens ?? 0) < filters.minContextTokens) return false;
    }
    if (filters.requiresCreditCard !== undefined) {
      if (modelRequiresCreditCard(feed, model) !== filters.requiresCreditCard) return false;
    }
    if (filters.requiresApiKey !== undefined) {
      if (modelRequiresApiKey(feed, model) !== filters.requiresApiKey) return false;
    }
    if (filters.available !== undefined) {
      if ((model.availability.status === "available") !== filters.available) return false;
    }
    if (profileOfferingId && model.id !== profileOfferingId) return false;
    if (filters.profile && !profileOfferingId) return false;
    if (filters.q) {
      if (!modelSearchHaystack(model).includes(filters.q.toLowerCase())) return false;
    }

    return model.policy.visibility === "listed";
  });
}

export function modelSearchHaystack(model: ModelOffering): string {
  return `${model.id} ${model.display_name} ${model.provider.name} ${model.provider_model_id}`.toLowerCase();
}

function modelRequiresApiKey(feed: FeedDocument, model: ModelOffering): boolean | undefined {
  if (model.pricing.free?.requires_api_key !== null && model.pricing.free?.requires_api_key !== undefined) {
    return model.pricing.free.requires_api_key;
  }

  return feed.providers.find((provider) => provider.id === model.provider.id)?.authentication.type === "api_key";
}

function modelRequiresCreditCard(feed: FeedDocument, model: ModelOffering): boolean | undefined {
  if (model.pricing.free?.requires_credit_card !== null && model.pricing.free?.requires_credit_card !== undefined) {
    return model.pricing.free.requires_credit_card;
  }

  return feed.providers.find((provider) => provider.id === model.provider.id)?.signup.credit_card_required ?? undefined;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
