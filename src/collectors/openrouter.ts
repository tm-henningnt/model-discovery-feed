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
      confidence: normalizeText(raw.canonical_slug) ? "high" : "medium"
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
      coding_score: null,
      reasoning_score: null,
      speed_score: null,
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
      })
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
