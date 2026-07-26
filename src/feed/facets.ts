import type { ModelOffering } from "./schema";
import { isConfidentlyFree } from "./classification";
import { modelPlanEditions, modelSearchHaystack } from "./filter";

/**
 * Client-side explorer filter state. Sets hold the selected values per facet;
 * empty set means "no restriction".
 */
export type ExplorerFilters = {
  query: string;
  freeOnly: boolean;
  providers: ReadonlySet<string>;
  planEditions: ReadonlySet<string>;
  capabilities: ReadonlySet<string>;
  pricing: ReadonlySet<string>;
  availability: ReadonlySet<string>;
  protocols: ReadonlySet<string>;
  minContext: number;
};

type SkippableFacet = "providers" | "planEditions" | "pricing" | "availability" | "protocols";

export function matchesExplorerFilters(
  model: ModelOffering,
  filters: ExplorerFilters,
  now: Date,
  skip?: SkippableFacet
): boolean {
  if (filters.freeOnly && !isConfidentlyFree(model, now)) return false;
  if (skip !== "providers" && filters.providers.size > 0 && !filters.providers.has(model.provider.id)) return false;
  // OR semantics: an offering in any selected edition stays. Personal is a subset of Team, so AND
  // would show only the overlap and hide the Team-only models the user asked to see.
  if (skip !== "planEditions" && filters.planEditions.size > 0) {
    const editions = modelPlanEditions(model);
    if (!editions.some((edition) => filters.planEditions.has(edition))) return false;
  }
  if (
    filters.capabilities.size > 0 &&
    ![...filters.capabilities].every((capability) => (model.capabilities as string[]).includes(capability))
  ) {
    return false;
  }
  if (skip !== "pricing" && filters.pricing.size > 0 && !filters.pricing.has(model.pricing.kind)) return false;
  if (skip !== "availability" && filters.availability.size > 0 && !filters.availability.has(model.availability.status)) {
    return false;
  }
  if (skip !== "protocols" && filters.protocols.size > 0 && !filters.protocols.has(model.endpoint.protocol)) {
    return false;
  }
  if (filters.minContext > 0 && (model.limits.context_tokens ?? 0) < filters.minContext) return false;

  const query = filters.query.trim().toLowerCase();
  if (query && !modelSearchHaystack(model).includes(query)) return false;

  return true;
}

export function filterExplorerModels(models: ModelOffering[], filters: ExplorerFilters, now: Date): ModelOffering[] {
  return models.filter((model) => matchesExplorerFilters(model, filters, now));
}

export type FacetCounts = {
  providers: Map<string, number>;
  planEditions: Map<string, number>;
  capabilities: Map<string, number>;
  pricing: Map<string, number>;
  availability: Map<string, number>;
  protocols: Map<string, number>;
};

/**
 * Faceted counts: each OR-semantics facet (provider, plan edition, pricing,
 * availability, protocol) is counted against the models matching every OTHER
 * active filter, so a value's count answers "how many results if I select
 * this". Capabilities filter with AND semantics, so their counts keep the
 * already-selected capabilities applied: an unchecked capability's count
 * answers "how many results if I ADD this one".
 */
export function computeFacetCounts(models: ModelOffering[], filters: ExplorerFilters, now: Date): FacetCounts {
  const count = (skip: SkippableFacet | undefined, pick: (model: ModelOffering) => string[]) => {
    const map = new Map<string, number>();
    for (const model of models) {
      if (!matchesExplorerFilters(model, filters, now, skip)) continue;
      for (const key of pick(model)) {
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  };

  return {
    providers: count("providers", (model) => [model.provider.id]),
    planEditions: count("planEditions", modelPlanEditions),
    capabilities: count(undefined, (model) => model.capabilities as string[]),
    pricing: count("pricing", (model) => [model.pricing.kind]),
    availability: count("availability", (model) => [model.availability.status]),
    protocols: count("protocols", (model) => [model.endpoint.protocol])
  };
}
