import type { ModelOffering, Provider } from "../feed/schema";
import type { Collector, CollectorContext, CollectorId, CollectorResult } from "./types";
import {
  claim,
  cleanCapabilityList,
  collectorNotice,
  fetchJson,
  hasAnyKeyword,
  nowIso,
  normalizeText,
  titleCaseFromSlug,
  toPositiveInt
} from "./shared";

type OpenCodeModel = {
  id: string;
  object?: string | null;
  created?: number | null;
  owned_by?: string | null;
  [key: string]: unknown;
};

type OpenCodeResponse = {
  object?: string;
  data?: OpenCodeModel[];
};

type OpenCodeVariant = {
  collectorId: CollectorId;
  provider: Provider;
  modelsUrl: string;
  billing: "subscription" | "metered";
};

const REASONING_KEYWORDS = ["reasoning", "think", "reason"];

const goVariant: OpenCodeVariant = {
  collectorId: "opencode-go",
  provider: {
    id: "opencode-go",
    object: "provider",
    name: "OpenCode Go",
    homepage: "https://opencode.ai",
    api_protocols: ["openai_chat_completions"],
    default_base_url: "https://opencode.ai/zen/go/v1",
    authentication: {
      type: "api_key",
      header: "Authorization",
      scheme: "Bearer",
      credential_hint: "OPENCODE_API_KEY"
    },
    signup: {
      required: true,
      credit_card_required: null
    },
    source_claims: []
  },
  modelsUrl: "https://opencode.ai/zen/go/v1/models",
  billing: "subscription"
};

const zenVariant: OpenCodeVariant = {
  collectorId: "opencode-zen",
  provider: {
    id: "opencode-zen",
    object: "provider",
    name: "OpenCode Zen",
    homepage: "https://opencode.ai",
    api_protocols: ["openai_chat_completions"],
    default_base_url: "https://opencode.ai/zen/v1",
    authentication: {
      type: "api_key",
      header: "Authorization",
      scheme: "Bearer",
      credential_hint: "OPENCODE_API_KEY"
    },
    signup: {
      required: true,
      credit_card_required: null
    },
    source_claims: []
  },
  modelsUrl: "https://opencode.ai/zen/v1/models",
  billing: "metered"
};

function normalizeOpenCodeModel(
  variant: OpenCodeVariant,
  raw: OpenCodeModel,
  observedAt: string,
  index: number
): ModelOffering | null {
  const providerModelId = normalizeText(raw.id);
  if (!providerModelId) {
    return null;
  }

  const providerId = variant.provider.id;
  const name = titleCaseFromSlug(providerModelId);
  const capabilityCandidates = new Set<string>(["chat", "streaming", "tool_use"]);
  if (hasAnyKeyword(providerModelId, REASONING_KEYWORDS)) {
    capabilityCandidates.add("reasoning");
  }

  const contextTokens = toPositiveInt(raw.context_length ?? raw.context_window);

  return {
    id: `${providerId}:${providerModelId}`,
    object: "model_offering",
    display_name: name,
    provider: {
      id: variant.provider.id,
      name: variant.provider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      id: providerModelId,
      confidence: "medium",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description: null,
    endpoint: {
      protocol: "openai_chat_completions",
      base_url: variant.provider.default_base_url,
      model: providerModelId
    },
    capabilities: cleanCapabilityList(capabilityCandidates),
    limits: {
      context_tokens: contextTokens,
      max_output_tokens: null
    },
    pricing:
      variant.billing === "subscription"
        ? {
            kind: "subscription_included",
            input_usd_per_1m_tokens: null,
            output_usd_per_1m_tokens: null,
            currency: null,
            metering: "tokens",
            free: null,
            subscription: {
              billing: "flat_monthly",
              per_token_billed: false,
              reference_pricing: true
            }
          }
        : {
            kind: "unknown",
            input_usd_per_1m_tokens: null,
            output_usd_per_1m_tokens: null,
            currency: null,
            metering: "tokens",
            free: null
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
      agentic_score: null,
      speed_score: null,
      benchmarks: null,
      recommendation_notes: []
    },
    source_claims: [
      claim({
        id: `${providerId}:${providerModelId}:model:${index}`,
        collector: variant.collectorId,
        sourceUrl: variant.modelsUrl,
        observedAt,
        fieldPaths:
          variant.billing === "subscription"
            ? ["capabilities", "endpoint.model", "availability.status", "pricing.kind"]
            : ["capabilities", "endpoint.model", "availability.status"],
        confidence: "medium",
        rawReference: {
          snapshot_id: `${providerId}-live-response`,
          json_pointer: `/data/${index}`,
          provider_model_id: providerModelId,
          source_url: variant.modelsUrl
        }
      })
    ],
    policy: {
      visibility: "listed",
      tags: Array.from(
        new Set(
          [
            hasAnyKeyword(providerModelId, REASONING_KEYWORDS) ? "reasoning" : null
          ].filter((item): item is string => Boolean(item))
        )
      ),
      recommended_for_agentic_workflows: capabilityCandidates.has("tool_use") ? true : null
    }
  };
}

function createOpenCodeCollector(variant: OpenCodeVariant): Collector {
  return {
    id: variant.collectorId,
    async collect(context: CollectorContext): Promise<CollectorResult> {
      const observedAt = nowIso(context);
      const apiKey = normalizeText(context.env.OPENCODE_API_KEY);
      const response = await fetchJson<OpenCodeResponse>(context, variant.modelsUrl, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
      });

      if (!response.ok) {
        return {
          provider: variant.provider,
          models: [],
          notices: [
            collectorNotice(variant.collectorId, "collector unavailable", {
              status: response.status,
              error: response.error
            })
          ]
        };
      }

      const models = (Array.isArray(response.data.data) ? response.data.data : [])
        .map((raw, index) => normalizeOpenCodeModel(variant, raw, observedAt, index))
        .filter((model): model is ModelOffering => model !== null);

      return {
        provider: variant.provider,
        models,
        notices: []
      };
    }
  };
}

export const opencodeGoCollector: Collector = createOpenCodeCollector(goVariant);
export const opencodeZenCollector: Collector = createOpenCodeCollector(zenVariant);
