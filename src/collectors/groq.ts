import type { ModelOffering, Provider } from "../feed/schema";
import type { Collector, CollectorContext, CollectorResult } from "./types";
import {
  claim,
  cleanCapabilityList,
  collectorNotice,
  fetchJson,
  hasAnyKeyword,
  nowIso,
  normalizeText,
  stripModelPrefix,
  toPositiveInt,
  usdPerMillionTokens
} from "./shared";

type GroqModel = {
  id: string;
  name?: string | null;
  description?: string | null;
  context_length?: number | null;
  context_window?: number | null;
  max_completion_tokens?: number | null;
  max_output_length?: number | null;
  supported_features?: string[] | null;
  input_modalities?: string[] | null;
  output_modalities?: string[] | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
    image?: string | null;
    request?: string | null;
    input_cache_read?: string | null;
  } | null;
  [key: string]: unknown;
};

type GroqResponse = {
  data?: GroqModel[];
};

const provider: Provider = {
  id: "groq",
  object: "provider",
  name: "Groq",
  homepage: "https://groq.com",
  api_protocols: ["openai_chat_completions"],
  default_base_url: "https://api.groq.com/openai/v1",
  authentication: {
    type: "api_key",
    header: "Authorization",
    scheme: "Bearer",
    credential_hint: "GROQ_API_KEY"
  },
  signup: {
    required: true,
    credit_card_required: null
  },
  source_claims: []
};

function normalizeGroqModel(raw: GroqModel, observedAt: string, index: number): ModelOffering | null {
  const providerModelId = normalizeText(raw.id);
  if (!providerModelId) {
    return null;
  }

  const name = normalizeText(raw.name) ?? stripModelPrefix(providerModelId);
  const description = normalizeText(raw.description);
  const contextTokens = toPositiveInt(raw.context_window ?? raw.context_length);
  const maxOutputTokens = toPositiveInt(raw.max_completion_tokens ?? raw.max_output_length);
  const capabilityCandidates = new Set<string>(["chat", "streaming"]);
  const supportedFeatures = Array.isArray(raw.supported_features) ? raw.supported_features : [];
  const inputModalities = Array.isArray(raw.input_modalities) ? raw.input_modalities : [];
  const outputModalities = Array.isArray(raw.output_modalities) ? raw.output_modalities : [];

  for (const token of supportedFeatures) {
    if (token === "tools" || token === "tool_choice") {
      capabilityCandidates.add("tool_use");
    }
    if (token === "json_mode" || token === "structured_outputs" || token === "response_format") {
      capabilityCandidates.add("structured_output");
    }
    if (token === "reasoning") {
      capabilityCandidates.add("reasoning");
    }
  }
  if (inputModalities.includes("image") || outputModalities.includes("image")) {
    capabilityCandidates.add("vision");
  }

  if (hasAnyKeyword(providerModelId, ["coder", "code", "coding"]) || hasAnyKeyword(name, ["coder", "code", "coding"]) || hasAnyKeyword(description ?? "", ["coder", "code", "coding"])) {
    capabilityCandidates.add("coding");
  }
  if (hasAnyKeyword(providerModelId, ["reasoning"]) || hasAnyKeyword(name, ["reasoning"]) || hasAnyKeyword(description ?? "", ["reasoning"])) {
    capabilityCandidates.add("reasoning");
  }

  const providerModelUrl = `https://api.groq.com/openai/v1/models/${providerModelId}`;

  const promptPrice = usdPerMillionTokens(raw.pricing?.prompt);
  const completionPrice = usdPerMillionTokens(raw.pricing?.completion);
  const isFree = promptPrice === 0 && completionPrice === 0;
  const pricingKind = isFree ? "free" : promptPrice === null || completionPrice === null ? "unknown" : "paid";

  return {
    id: `groq:${providerModelId}`,
    object: "model_offering",
    display_name: name,
    provider: {
      id: provider.id,
      name: provider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      id: providerModelId,
      confidence: "medium"
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
            expires_at: null,
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
        id: `groq:${providerModelId}:model:${index}`,
        collector: "groq",
        sourceUrl: "https://api.groq.com/openai/v1/models",
        observedAt,
        fieldPaths: [
          "capabilities",
          "limits.context_tokens",
          "limits.max_output_tokens",
          "pricing.kind",
          "pricing.input_usd_per_1m_tokens",
          "pricing.output_usd_per_1m_tokens",
          "availability.status"
        ],
        confidence: "medium",
        rawReference: {
          snapshot_id: "groq-live-response",
          json_pointer: `/data/${index}`,
          provider_model_id: providerModelId,
          source_url: providerModelUrl
        }
      })
    ],
    policy: {
      visibility: "listed",
      tags: Array.from(
        new Set(
          [
            hasAnyKeyword(providerModelId, ["coder", "code", "coding"]) ? "coding" : null,
            hasAnyKeyword(providerModelId, ["reasoning"]) ? "reasoning" : null
          ].filter((item): item is string => Boolean(item))
        )
      ),
      recommended_for_agentic_workflows: capabilityCandidates.has("tool_use") || capabilityCandidates.has("structured_output") ? true : null
    }
  };
}

export const groqCollector: Collector = {
  id: "groq",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const observedAt = nowIso(context);
    const apiKey = normalizeText(context.env.GROQ_API_KEY);
    const response = await fetchJson<GroqResponse>(context, "https://api.groq.com/openai/v1/models", {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    });

    if (!response.ok) {
      return {
        provider,
        models: [],
        notices: [
          collectorNotice("groq", "collector unavailable", {
            status: response.status,
            error: response.error,
            has_api_key: Boolean(apiKey)
          })
        ]
      };
    }

    const models = (Array.isArray(response.data.data) ? response.data.data : [])
      .map((raw, index) => normalizeGroqModel(raw, observedAt, index))
      .filter((model): model is ModelOffering => model !== null);

    return {
      provider,
      models,
      notices: []
    };
  }
};
