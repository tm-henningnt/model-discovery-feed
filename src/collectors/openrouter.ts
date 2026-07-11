import type { ModelOffering, Provider } from "../feed/schema";
import type { Collector, CollectorContext, CollectorResult } from "./types";
import {
  claim,
  cleanCapabilityList,
  collectorNotice,
  fetchJson,
  hasAnyKeyword,
  nowIso,
  normalizeDatetime,
  normalizeText,
  toPositiveInt,
  usdPerMillionTokens
} from "./shared";

type DesignArenaEntry = {
  arena?: unknown;
  category?: unknown;
  elo?: unknown;
  win_rate?: unknown;
  rank?: unknown;
};

type OpenRouterModel = {
  id: string;
  canonical_slug?: string | null;
  name?: string | null;
  description?: string | null;
  context_length?: number | null;
  pricing?: {
    prompt?: string | number | null;
    completion?: string | number | null;
  } | null;
  top_provider?: {
    max_completion_tokens?: number | null;
  } | null;
  supported_parameters?: string[] | null;
  architecture?: {
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
  } | null;
  reasoning?: {
    mandatory?: boolean | null;
  } | null;
  benchmarks?: {
    artificial_analysis?: Record<string, unknown> | null;
    design_arena?: DesignArenaEntry[] | null;
  } | null;
  expiration_date?: string | null;
  [key: string]: unknown;
};

type OpenRouterResponse = {
  data?: OpenRouterModel[];
};

const provider: Provider = {
  id: "openrouter",
  object: "provider",
  name: "OpenRouter",
  homepage: "https://openrouter.ai",
  api_protocols: ["openai_chat_completions"],
  default_base_url: "https://openrouter.ai/api/v1",
  authentication: {
    type: "api_key",
    header: "Authorization",
    scheme: "Bearer",
    credential_hint: "OPENROUTER_API_KEY"
  },
  signup: {
    required: true,
    credit_card_required: null
  },
  source_claims: []
};

function numericFields(values: Record<string, unknown> | null | undefined): Record<string, number> | null {
  if (!values) {
    return null;
  }

  const numeric: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      numeric[key] = value;
    }
  }

  return Object.keys(numeric).length > 0 ? numeric : null;
}

function designArenaEntries(entries: DesignArenaEntry[] | null | undefined): Array<{
  arena: string | null;
  category: string | null;
  elo: number | null;
  win_rate: number | null;
  rank: number | null;
}> | null {
  if (!Array.isArray(entries)) {
    return null;
  }

  const normalized = entries.map((entry) => ({
    arena: typeof entry.arena === "string" ? entry.arena : null,
    category: typeof entry.category === "string" ? entry.category : null,
    elo: typeof entry.elo === "number" && Number.isFinite(entry.elo) ? entry.elo : null,
    win_rate: typeof entry.win_rate === "number" && Number.isFinite(entry.win_rate) ? entry.win_rate : null,
    rank: typeof entry.rank === "number" && Number.isFinite(entry.rank) ? entry.rank : null
  }));

  return normalized.length > 0 ? normalized : null;
}

function normalizeOpenRouterModel(raw: OpenRouterModel, observedAt: string, index: number): ModelOffering | null {
  const providerModelId = normalizeText(raw.id);
  if (!providerModelId) {
    return null;
  }

  const name = normalizeText(raw.name) ?? providerModelId;
  const description = normalizeText(raw.description);
  const canonicalId = normalizeText(raw.canonical_slug) ?? providerModelId;
  const contextTokens = toPositiveInt(raw.context_length);
  const maxOutputTokens = toPositiveInt(raw.top_provider?.max_completion_tokens);
  const supportedParameters = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const inputModalities = raw.architecture && Array.isArray(raw.architecture.input_modalities) ? raw.architecture.input_modalities : [];
  const outputModalities = raw.architecture && Array.isArray(raw.architecture.output_modalities) ? raw.architecture.output_modalities : [];
  const capabilityCandidates = new Set<string>(["chat", "streaming"]);

  if (supportedParameters.some((item) => ["tools", "tool_choice"].includes(item))) {
    capabilityCandidates.add("tool_use");
  }
  if (supportedParameters.includes("response_format")) {
    capabilityCandidates.add("structured_output");
  }
  if (supportedParameters.some((item) => item === "reasoning" || item === "include_reasoning") || raw.reasoning?.mandatory) {
    capabilityCandidates.add("reasoning");
  }
  if (inputModalities.some((item) => item === "image") || outputModalities.some((item) => item === "image")) {
    capabilityCandidates.add("vision");
  }
  if (hasAnyKeyword(providerModelId, ["coder", "code", "coding"]) || hasAnyKeyword(name, ["coder", "code", "coding"]) || hasAnyKeyword(description ?? "", ["coder", "code", "coding"])) {
    capabilityCandidates.add("coding");
  }

  const promptPrice = usdPerMillionTokens(raw.pricing?.prompt);
  const completionPrice = usdPerMillionTokens(raw.pricing?.completion);
  const isFree = promptPrice === 0 && completionPrice === 0;
  const pricingKind = isFree ? "free" : promptPrice === null || completionPrice === null ? "unknown" : "paid";
  const artificialAnalysis = numericFields(raw.benchmarks?.artificial_analysis);
  const designArena = designArenaEntries(raw.benchmarks?.design_arena);
  const benchmarks = artificialAnalysis || designArena
    ? {
        math_score: artificialAnalysis?.math_index ?? null,
        ttft_seconds: null,
        artificial_analysis: artificialAnalysis,
        design_arena: designArena
      }
    : null;
  const artificialAnalysisFieldPaths = [
    artificialAnalysis?.coding_index !== undefined ? "quality.coding_score" : null,
    artificialAnalysis?.intelligence_index !== undefined ? "quality.reasoning_score" : null,
    artificialAnalysis?.agentic_index !== undefined ? "quality.agentic_score" : null,
    artificialAnalysis?.math_index !== undefined ? "quality.benchmarks.math_score" : null,
    artificialAnalysis ? "quality.benchmarks.artificial_analysis" : null
  ].filter((fieldPath): fieldPath is string => fieldPath !== null);

  return {
    id: `openrouter:${providerModelId}`,
    object: "model_offering",
    display_name: name,
    provider: {
      id: provider.id,
      name: provider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      id: canonicalId,
      confidence: normalizeText(raw.canonical_slug) ? "high" : "medium",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description,
    endpoint: {
      protocol: "openai_chat_completions",
      base_url: provider.default_base_url,
      model: providerModelId
    },
    capabilities: cleanCapabilityList(capabilityCandidates),
    limits: {
      context_tokens: contextTokens,
      max_output_tokens: maxOutputTokens
    },
    pricing: {
      kind: pricingKind,
      input_usd_per_1m_tokens: promptPrice,
      output_usd_per_1m_tokens: completionPrice,
      currency: isFree || promptPrice !== null || completionPrice !== null ? "USD" : null,
      metering: "tokens",
      free: isFree
        ? {
            is_currently_free: true,
            basis: "zero_priced_model",
            requires_account: true,
            requires_api_key: true,
            requires_credit_card: null,
            quota: null,
            expires_at: normalizeDatetime(raw.expiration_date),
            last_verified_at: observedAt,
            confidence: "high"
          }
        : null
    },
    availability: {
      status: "available",
      last_checked_at: observedAt,
      last_success_at: observedAt,
      stale_after_seconds: 86400
    },
    quality: {
      coding_score: artificialAnalysis?.coding_index ?? null,
      reasoning_score: artificialAnalysis?.intelligence_index ?? null,
      agentic_score: artificialAnalysis?.agentic_index ?? null,
      speed_score: null,
      benchmarks,
      recommendation_notes: []
    },
    source_claims: [
      claim({
        id: `openrouter:${providerModelId}:model:${index}`,
        collector: "openrouter",
        sourceUrl: "https://openrouter.ai/api/v1/models",
        observedAt,
        fieldPaths: [
          "pricing.input_usd_per_1m_tokens",
          "pricing.output_usd_per_1m_tokens",
          "limits.context_tokens",
          "limits.max_output_tokens",
          "capabilities",
          "availability.status"
        ],
        confidence: "high",
        rawReference: {
          snapshot_id: "openrouter-live-response",
          json_pointer: `/data/${index}`,
          provider_model_id: providerModelId
        }
      }),
      ...(artificialAnalysis
        ? [
            claim({
              id: `openrouter:${providerModelId}:artificial-analysis:${index}`,
              collector: "openrouter",
              sourceType: "third_party_catalog",
              sourceUrl: "https://artificialanalysis.ai/",
              observedAt,
              fieldPaths: artificialAnalysisFieldPaths,
              confidence: "high",
              rawReference: {
                snapshot_id: "openrouter-live-response",
                json_pointer: `/data/${index}/benchmarks/artificial_analysis`,
                provider_model_id: providerModelId
              }
            })
          ]
        : []),
      ...(designArena && designArena.length > 0
        ? [
            claim({
              id: `openrouter:${providerModelId}:design-arena:${index}`,
              collector: "openrouter",
              sourceType: "third_party_catalog",
              sourceUrl: "https://designarena.ai/",
              observedAt,
              fieldPaths: ["quality.benchmarks.design_arena"],
              confidence: "high",
              rawReference: {
                snapshot_id: "openrouter-live-response",
                json_pointer: `/data/${index}/benchmarks/design_arena`,
                provider_model_id: providerModelId
              }
            })
          ]
        : [])
    ],
    policy: {
      visibility: "listed",
      tags: Array.from(
        new Set(
          [
            isFree ? "free" : null,
            hasAnyKeyword(providerModelId, ["coder", "code", "coding"]) ? "coding" : null,
            hasAnyKeyword(name, ["reasoning"]) ? "reasoning" : null
          ].filter((item): item is string => Boolean(item))
        )
      ),
      recommended_for_agentic_workflows: capabilityCandidates.has("tool_use") || capabilityCandidates.has("structured_output") ? true : null
    }
  };
}

export const openrouterCollector: Collector = {
  id: "openrouter",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const observedAt = nowIso(context);
    const response = await fetchJson<OpenRouterResponse>(context, "https://openrouter.ai/api/v1/models");

    if (!response.ok) {
      return {
        provider,
        models: [],
        notices: [
          collectorNotice("openrouter", "collector unavailable", {
            status: response.status,
            error: response.error
          })
        ]
      };
    }

    const models = (Array.isArray(response.data.data) ? response.data.data : [])
      .map((raw, index) => normalizeOpenRouterModel(raw, observedAt, index))
      .filter((model): model is ModelOffering => model !== null);

    return {
      provider,
      models,
      notices: []
    };
  }
};
