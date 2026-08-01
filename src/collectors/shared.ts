import type {
  Capability,
  Confidence,
  EndpointProtocol,
  ModelOffering,
  Provider,
  SourceClaim
} from "../feed/schema";
import type { CollectorContext, CollectorNotice } from "./types";

const DEFAULT_TIMEOUT_MS = 15000;

export function nowIso(context: CollectorContext): string {
  return context.now.toISOString();
}

export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeUrl(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  try {
    return new URL(text).toString();
  } catch {
    return null;
  }
}

export function normalizeDatetime(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

export function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

export function usdPerMillionTokens(value: unknown): number | null {
  const asNumber = toNonNegativeNumber(value);
  return asNumber === null ? null : asNumber * 1_000_000;
}

export type CollectorPricing = ModelOffering["pricing"];

export interface TokenPricingInput {
  /** Raw per-token input rate as the provider published it, e.g. `"0.00000014"`. */
  prompt: unknown;
  /** Raw per-token output rate as the provider published it. */
  completion: unknown;
  /**
   * Output modalities the provider declares. An absent or empty list means the
   * collector cannot tell, and the meter is assumed to be tokens.
   */
  outputModalities?: string[] | null;
  expiresAt?: string | null;
  observedAt: string;
  /**
   * How much the collector trusts a zero rate as a free claim about *this*
   * seller. A reseller that republishes another catalog's rates must pass
   * `"low"`, because the zero came from the upstream price list.
   */
  freeConfidence?: Confidence;
}

/** A rate in USD per million tokens describes the bill only when tokens are the meter. */
function meteredInTokens(outputModalities: string[] | null | undefined): boolean {
  if (!Array.isArray(outputModalities) || outputModalities.length === 0) {
    return true;
  }
  return outputModalities.every((item) => item === "text");
}

function zeroPricedFree(input: TokenPricingInput): NonNullable<CollectorPricing["free"]> {
  return {
    is_currently_free: true,
    basis: "zero_priced_model",
    requires_account: true,
    requires_api_key: true,
    requires_credit_card: null,
    quota: null,
    expires_at: normalizeDatetime(input.expiresAt),
    last_verified_at: input.observedAt,
    confidence: input.freeConfidence ?? "high"
  };
}

/**
 * Derives a pricing block from a provider's published per-token rates.
 *
 * A zero rate is evidence of free only when tokens are the meter. A model that
 * bills per song or per image publishes `0` in the token fields because those
 * fields do not apply to it, so this returns `unknown` with null rates rather
 * than a free claim. `src/enrichers/models-dev.ts` guards the same way.
 */
export function tokenPricing(input: TokenPricingInput): CollectorPricing {
  const inputRate = usdPerMillionTokens(input.prompt);
  const outputRate = usdPerMillionTokens(input.completion);
  const bothZero = inputRate === 0 && outputRate === 0;

  if (bothZero && !meteredInTokens(input.outputModalities)) {
    return {
      kind: "unknown",
      input_usd_per_1m_tokens: null,
      output_usd_per_1m_tokens: null,
      currency: null,
      metering: null,
      free: null
    };
  }

  const kind = bothZero ? "free" : inputRate === null || outputRate === null ? "unknown" : "paid";

  return {
    kind,
    input_usd_per_1m_tokens: inputRate,
    output_usd_per_1m_tokens: outputRate,
    currency: bothZero || inputRate !== null || outputRate !== null ? "USD" : null,
    metering: "tokens",
    free: bothZero ? zeroPricedFree(input) : null
  };
}

/**
 * Pricing for an offering the seller itself publishes as free to its account
 * holders. The rates are `0` because that is what the account is billed; any
 * pay-as-you-go rate for the same model belongs in a source claim, not here.
 *
 * `kind` stays `"free"` rather than `"free_tier"` so the offering satisfies
 * `isConfidentlyFree`, and `basis` records that the seller granted the tier.
 */
export function accountFreeTierPricing(observedAt: string, quota: string | null = null): CollectorPricing {
  return {
    kind: "free",
    input_usd_per_1m_tokens: 0,
    output_usd_per_1m_tokens: 0,
    currency: "USD",
    metering: "tokens",
    free: {
      is_currently_free: true,
      basis: "account_free_tier",
      requires_account: true,
      requires_api_key: true,
      requires_credit_card: null,
      quota,
      expires_at: null,
      last_verified_at: observedAt,
      confidence: "high"
    }
  };
}

export function cleanCapabilityList(values: Iterable<Capability | string | null | undefined>): Capability[] {
  const out = new Set<Capability>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const token = value.trim() as Capability;
    if (token) {
      out.add(token);
    }
  }
  return [...out];
}

export function claim(params: {
  id: string;
  collector: string;
  sourceType?: SourceClaim["source_type"];
  sourceUrl: string | null;
  observedAt: string;
  fieldPaths: string[];
  confidence: SourceClaim["confidence"];
  rawReference: Record<string, unknown> | null;
}): SourceClaim {
  return {
    id: params.id,
    collector: params.collector,
    source_type: params.sourceType ?? "provider_api",
    source_url: params.sourceUrl,
    observed_at: params.observedAt,
    field_paths: params.fieldPaths,
    confidence: params.confidence,
    raw_reference: params.rawReference
  };
}

export function providerBase(provider: Provider): Provider {
  return provider;
}

export function buildModelOffering(input: ModelOffering): ModelOffering {
  return input;
}

export interface FetchJsonSuccess<T> {
  ok: true;
  status: number;
  data: T;
  rawText: string;
}

export interface FetchJsonFailure {
  ok: false;
  status: number;
  error: string;
  rawText: string | null;
}

export type FetchJsonResult<T> = FetchJsonSuccess<T> | FetchJsonFailure;

export async function fetchJson<T>(
  context: CollectorContext,
  url: string,
  init?: RequestInit
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");

    const response = await context.fetch(url, {
      ...init,
      signal: controller.signal,
      headers
    });

    const rawText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: rawText.trim() || `HTTP ${response.status}`,
        rawText: rawText || null
      };
    }

    if (rawText.trim().length === 0) {
      return {
        ok: false,
        status: response.status,
        error: "empty response body",
        rawText: null
      };
    }

    try {
      return {
        ok: true,
        status: response.status,
        data: JSON.parse(rawText) as T,
        rawText
      };
    } catch (error) {
      return {
        ok: false,
        status: response.status,
        error: error instanceof Error ? error.message : "failed to parse JSON response",
        rawText
      };
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "request failed",
      rawText: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface FetchTextSuccess {
  ok: true;
  status: number;
  text: string;
}

export type FetchTextResult = FetchTextSuccess | FetchJsonFailure;

/**
 * Fetches a plain-text document. Some providers publish a machine-readable
 * roster only as Markdown (see ADR 0007), so a text sibling of `fetchJson` is
 * needed; it keeps the same timeout, abort, and failure shape.
 */
export async function fetchText(
  context: CollectorContext,
  url: string,
  init?: RequestInit
): Promise<FetchTextResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("accept")) {
      headers.set("accept", "text/plain, text/markdown, */*");
    }

    const response = await context.fetch(url, {
      ...init,
      signal: controller.signal,
      headers
    });

    const rawText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: rawText.trim() || `HTTP ${response.status}`,
        rawText: rawText || null
      };
    }

    if (rawText.trim().length === 0) {
      return {
        ok: false,
        status: response.status,
        error: "empty response body",
        rawText: null
      };
    }

    return { ok: true, status: response.status, text: rawText };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "request failed",
      rawText: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function collectorNotice(
  collector: string,
  message: string,
  extra: Record<string, unknown> = {}
): CollectorNotice {
  return {
    collector,
    message,
    ...extra
  };
}

export function titleCaseFromSlug(value: string): string {
  return value
    .split(/[-_/]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function stripModelPrefix(value: string): string {
  return value.startsWith("models/") ? value.slice("models/".length) : value;
}

export function hasAnyKeyword(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function endpointProtocol(protocol: EndpointProtocol): EndpointProtocol {
  return protocol;
}
