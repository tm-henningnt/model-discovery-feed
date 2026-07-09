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
  toPositiveInt
} from "./shared";

type GroqModel = {
  id: string;
  name?: string | null;
  description?: string | null;
  context_length?: number | null;
  max_context_length?: number | null;
  max_completion_tokens?: number | null;
  supported_parameters?: string[] | null;
  capabilities?: string[] | null;
  modalities?: string[] | null;
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
  const contextTokens = toPositiveInt(raw.max_context_length ?? raw.context_length);
  const maxOutputTokens = toPositiveInt(raw.max_completion_tokens);
  const capabilityCandidates = new Set<string>(["chat", "streaming"]);

  for (const token of [...(raw.capabilities ?? []), ...(raw.supported_parameters ?? []), ...(raw.modalities ?? [])]) {
    if (token === "tools" || token === "tool_choice" || token === "tool-calling") {
      capabilityCandidates.add("tool_use");
    }
    if (token === "response_format") {
      capabilityCandidates.add("structured_output");
    }
    if (token === "reasoning") {
      capabilityCandidates.add("reasoning");
    }
    if (token === "image" || token === "vision") {
      capabilityCandidates.add("vision");
    }
  }

  if (hasAnyKeyword(providerModelId, ["coder", "code", "coding"]) || hasAnyKeyword(name, ["coder", "code", "coding"]) || hasAnyKeyword(description ?? "", ["coder", "code", "coding"])) {
    capabilityCandidates.add("coding");
  }
  if (hasAnyKeyword(providerModelId, ["reasoning"]) || hasAnyKeyword(name, ["reasoning"]) || hasAnyKeyword(description ?? "", ["reasoning"])) {
    capabilityCandidates.add("reasoning");
  }

  const providerModelUrl = `https://api.groq.com/openai/v1/models/${providerModelId}`;

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
      speed_score: null,
      recommendation_notes: []
    },
    source_claims: [
      claim({
        id: `groq:${providerModelId}:model:${index}`,
        collector: "groq",
        sourceUrl: "https://api.groq.com/openai/v1/models",
        observedAt,
        fieldPaths: ["capabilities", "limits.context_tokens", "limits.max_output_tokens", "availability.status"],
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
    const response = await fetchJson<GroqResponse>(context, "https://api.groq.com/openai/v1/models");

    if (!response.ok) {
      return {
        provider,
        models: [],
        notices: [
          collectorNotice("groq", "collector unavailable", {
            status: response.status,
            error: response.error
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
