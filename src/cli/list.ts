import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { explainPricing } from "../feed/classification";
import { filterModels, type ModelFilters } from "../feed/filter";
import { compareForBestFreeCoder } from "../feed/ranking";
import { validateFeedDocument, type FeedDocument, type SourceClaim } from "../feed/schema";

export type CliListOptions = ModelFilters & {
  feedUrl: string;
  json: boolean;
  apiKey?: string;
  etag?: string;
  cachePath?: string;
};

export type CliListRow = {
  id: string;
  display_name: string;
  provider: {
    id: string;
    name: string;
  };
  endpoint: {
    protocol: string;
    base_url: string | null;
    model: string;
  };
  capabilities: string[];
  context_tokens: number | null;
  pricing_kind: string;
  pricing_explanation: string;
  availability: string;
  source_claims: Array<{
    source_type: string;
    source_url: string | null;
    observed_at: string;
    confidence: string;
  }>;
};

export type CliInvocation =
  | {
      kind: "help";
      scope: "root" | "list";
    }
  | {
      kind: "list";
      options: CliListOptions;
    }
  | {
      kind: "error";
      message: string;
    };

type FeedCache = {
  etag: string | null;
  feed: FeedDocument;
};

const DEFAULT_FEED_URL = "http://localhost:3000/v1/feed";

export const USAGE = [
  "Usage:",
  "  model-feed [list] [options]",
  "  model-feed --help",
  "  model-feed list --help",
  "",
  "Options:",
  "  --feed <url>               Feed URL to query",
  "  --api-key <token>          Authorization bearer token",
  "  --etag <etag>              Send If-None-Match with the supplied ETag",
  "  --cache <path>             Read and update a JSON feed cache",
  "  --free                     Filter for confidently free models",
  "  --pricing-kind <kind>      Filter by pricing kind",
  "  --provider <id>            Filter by provider id",
  "  --capability <name>        Filter by capability",
  "  --protocol <name>          Filter by endpoint protocol",
  "  --min-context-tokens <n>   Filter by minimum context window",
  "  --json                     Emit JSON output"
].join("\n");

export function parseCliArgs(argv: string[]): CliInvocation {
  if (argv.length === 0) {
    return { kind: "list", options: defaultListOptions() };
  }

  const [first, ...rest] = argv;
  if (first === "--help" || first === "-h" || first === "help") {
    return { kind: "help", scope: "root" };
  }

  if (!first.startsWith("-")) {
    if (first !== "list") {
      return {
        kind: "error",
        message: `Unknown command: ${first}. Try "model-feed --help".`
      };
    }

    if (rest.includes("--help") || rest.includes("-h")) {
      return { kind: "help", scope: "list" };
    }

    return { kind: "list", options: parseListArgs(rest) };
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    return { kind: "help", scope: "root" };
  }

  return { kind: "list", options: parseListArgs(argv) };
}

export async function fetchFeed(
  feedUrl: string,
  options: {
    apiKey?: string;
    etag?: string;
    cachePath?: string;
  } = {}
): Promise<{ feed: FeedDocument; etag: string | null }> {
  const cachedFeed = options.cachePath ? await readFeedCache(options.cachePath) : null;
  const requestEtag = options.etag ?? cachedFeed?.etag ?? null;
  const apiKey = options.apiKey ?? process.env.MODEL_FEED_API_KEY;
  const headers: Record<string, string> = {};

  if (requestEtag) {
    headers["If-None-Match"] = requestEtag;
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(feedUrl, {
    headers: Object.keys(headers).length > 0 ? headers : undefined
  });

  if (response.status === 304) {
    if (!cachedFeed?.feed) {
      throw new Error(
        options.cachePath
          ? `Feed returned 304 but no cached feed was available at ${options.cachePath}`
          : "Feed returned 304 but no cached feed was available"
      );
    }

    return {
      feed: cachedFeed.feed,
      etag: cachedFeed.etag
    };
  }

  if (!response.ok) {
    throw new Error(`Feed request failed with HTTP ${response.status}`);
  }

  const feed = validateFeedDocument(await response.json());
  const etag = response.headers.get("ETag");

  if (options.cachePath) {
    await writeFeedCache(options.cachePath, {
      etag,
      feed
    });
  }

  return { feed, etag };
}

export async function listModels(options: CliListOptions): Promise<unknown> {
  const { feed } = await fetchFeed(options.feedUrl, {
    apiKey: options.apiKey,
    etag: options.etag,
    cachePath: options.cachePath
  });

  return listRows(feed, options);
}

export function listRows(feed: FeedDocument, filters: ModelFilters, now = new Date()): CliListRow[] {
  return filterModels(feed, filters, now)
    .sort((a, b) => compareForBestFreeCoder(a, b, now))
    .map((model) => toListRow(model, now));
}

function parseListArgs(argv: string[]): CliListOptions {
  const options = defaultListOptions();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--help":
      case "-h":
        break;
      case "--feed":
        options.feedUrl = requireValue(arg, next);
        index += 1;
        break;
      case "--free":
        options.free = true;
        break;
      case "--pricing-kind":
        options.pricingKind = requireValue(arg, next) as never;
        index += 1;
        break;
      case "--provider":
        options.provider = requireValue(arg, next);
        index += 1;
        break;
      case "--capability":
        options.capability = requireValue(arg, next);
        index += 1;
        break;
      case "--protocol":
        options.protocol = requireValue(arg, next);
        index += 1;
        break;
      case "--min-context-tokens":
        if (next === undefined) {
          throw new Error(`Missing value for ${arg}`);
        }

        options.minContextTokens = parsePositiveNumber(next, arg);
        index += 1;
        break;
      case "--json":
        options.json = true;
        break;
      case "--api-key":
        options.apiKey = requireValue(arg, next);
        index += 1;
        break;
      case "--etag":
        options.etag = requireValue(arg, next);
        index += 1;
        break;
      case "--cache":
        options.cachePath = requireValue(arg, next);
        index += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function defaultListOptions(): CliListOptions {
  return {
    feedUrl: DEFAULT_FEED_URL,
    json: false
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parsePositiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}`);
  }

  return parsed;
}

export function toListRow(model: Parameters<typeof explainPricing>[0], now = new Date()): CliListRow {
  return {
    id: model.id,
    display_name: model.display_name,
    provider: model.provider,
    endpoint: model.endpoint,
    capabilities: model.capabilities,
    context_tokens: model.limits.context_tokens,
    pricing_kind: model.pricing.kind,
    pricing_explanation: explainPricing(model, now),
    availability: model.availability.status,
    source_claims: model.source_claims.map((claim: SourceClaim) => ({
      source_type: claim.source_type,
      source_url: claim.source_url,
      observed_at: claim.observed_at,
      confidence: claim.confidence
    }))
  };
}

async function readFeedCache(cachePath: string): Promise<FeedCache | null> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<FeedCache> | null;

    if (!parsed || typeof parsed !== "object" || !("feed" in parsed)) {
      throw new Error("cache is missing a feed document");
    }

    return {
      etag: typeof parsed.etag === "string" ? parsed.etag : null,
      feed: validateFeedDocument(parsed.feed)
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw new Error(`Failed to read feed cache at ${cachePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeFeedCache(cachePath: string, cache: FeedCache): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache), "utf8");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
