import type { FeedDocument, Provider } from "./schema";

export type ProviderFilters = {
  id?: string;
  protocol?: string;
  q?: string;
};

export function providerFiltersFromSearchParams(params: URLSearchParams): ProviderFilters {
  return {
    id: params.get("id") ?? undefined,
    protocol: params.get("protocol") ?? undefined,
    q: params.get("q") ?? undefined
  };
}

export function filterProviders(feed: FeedDocument, filters: ProviderFilters): Provider[] {
  return feed.providers.filter((provider) => {
    if (filters.id && provider.id !== filters.id) return false;
    if (filters.protocol && !provider.api_protocols.includes(filters.protocol as never)) return false;
    if (filters.q) {
      const haystack = `${provider.id} ${provider.name} ${provider.homepage ?? ""}`.toLowerCase();
      if (!haystack.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  });
}
