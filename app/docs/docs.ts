export type DocMeta = {
  slug: string;
  title: string;
  summary: string;
  file: string;
};

// Rendered from the authoritative markdown under docs/public/.
export const DOCS: DocMeta[] = [
  {
    slug: "model-discovery-feed",
    title: "Feed contract",
    summary: "The object model, invariants, endpoints, and adapter boundaries of the feed.",
    file: "model-discovery-feed.md"
  },
  {
    slug: "client-integration-guide",
    title: "Client integration guide",
    summary: "How to build an adapter: authentication, caching, status, and the document schema.",
    file: "client-integration-guide.md"
  }
];

export function findDoc(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}
