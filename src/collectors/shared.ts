import type { Capability, EndpointProtocol, ModelOffering, Provider, SourceClaim } from "../feed/schema";
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
