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

type GeminiModel = {
  name: string;
  baseModelId?: string | null;
  version?: string | null;
  displayName?: string | null;
  description?: string | null;
  inputTokenLimit?: number | null;
  outputTokenLimit?: number | null;
  supportedGenerationMethods?: string[] | null;
  thinking?: boolean | null;
  [key: string]: unknown;
};

type GeminiResponse = {
  models?: GeminiModel[];
  nextPageToken?: string | null;
};

const provider: Provider = {
  id: "gemini",
  object: "provider",
  name: "Gemini",
  homepage: "https://ai.google.dev",
  api_protocols: ["gemini_generate_content"],
  default_base_url: "https://generativelanguage.googleapis.com/v1beta",
  authentication: {
    type: "api_key",
    header: null,
    scheme: null,
    credential_hint: "GEMINI_API_KEY"
  },
  signup: {
    required: true,
    credit_card_required: null
  },
  source_claims: []
};

async function listGeminiModels(context: CollectorContext): Promise<GeminiModel[]> {
  const apiKey = normalizeText(context.env.GEMINI_API_KEY);
  const models: GeminiModel[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (apiKey) {
      url.searchParams.set("key", apiKey);
    }
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetchJson<GeminiResponse>(context, url.toString());
    if (!response.ok) {
      return models;
    }

    const pageModels = Array.isArray(response.data.models) ? response.data.models : [];
    models.push(...pageModels);
    if (!response.data.nextPageToken) {
      return models;
    }
    pageToken = response.data.nextPageToken;
  }

  return models;
}

function normalizeGeminiModel(raw: GeminiModel, observedAt: string, index: number): ModelOffering | null {
  const endpointModel = normalizeText(raw.name);
  if (!endpointModel) {
    return null;
  }

  const providerModelId = normalizeText(raw.baseModelId) ?? stripModelPrefix(endpointModel);
  const displayName = normalizeText(raw.displayName) ?? providerModelId;
  const description = normalizeText(raw.description);
  const capabilityCandidates = new Set<string>(["chat"]);
  const methods = Array.isArray(raw.supportedGenerationMethods) ? raw.supportedGenerationMethods : [];

  if (methods.some((method) => method.toLowerCase().includes("embed"))) {
    capabilityCandidates.add("embeddings");
  }
  if (methods.some((method) => method.toLowerCase().includes("stream"))) {
    capabilityCandidates.add("streaming");
  }
  if (raw.thinking) {
    capabilityCandidates.add("reasoning");
  }
  if (hasAnyKeyword(providerModelId, ["image"]) || hasAnyKeyword(displayName, ["image"]) || hasAnyKeyword(description ?? "", ["image"])) {
    capabilityCandidates.add("image_generation");
  }

  const contextTokens = toPositiveInt(raw.inputTokenLimit);
  const maxOutputTokens = toPositiveInt(raw.outputTokenLimit);

  return {
    id: `gemini:${providerModelId}`,
    object: "model_offering",
    display_name: displayName,
    provider: {
      id: provider.id,
      name: provider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      id: providerModelId,
      confidence: normalizeText(raw.baseModelId) ? "high" : "medium"
    },
    description,
    endpoint: {
      protocol: "gemini_generate_content",
      base_url: provider.default_base_url,
      model: endpointModel
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
        id: `gemini:${providerModelId}:model:${index}`,
        collector: "gemini",
        sourceUrl: "https://generativelanguage.googleapis.com/v1beta/models",
        observedAt,
        fieldPaths: [
          "provider_model_id",
          "endpoint.model",
          "limits.context_tokens",
          "limits.max_output_tokens",
          "capabilities",
          "availability.status"
        ],
        confidence: "high",
        rawReference: {
          snapshot_id: "gemini-live-response",
          json_pointer: `/models/${index}`
        }
      })
    ],
    policy: {
      visibility: "listed",
      tags: Array.from(
        new Set(
          [
            hasAnyKeyword(providerModelId, ["image"]) ? "image" : null,
            raw.thinking ? "reasoning" : null
          ].filter((item): item is string => Boolean(item))
        )
      ),
      recommended_for_agentic_workflows: capabilityCandidates.has("tool_use") ? true : null
    }
  };
}

export const geminiCollector: Collector = {
  id: "gemini",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const observedAt = nowIso(context);
    const rawModels = await listGeminiModels(context);

    if (rawModels.length === 0) {
      return {
        provider,
        models: [],
        notices: [
          collectorNotice("gemini", "collector unavailable or returned no models", {
            has_api_key: Boolean(normalizeText(context.env.GEMINI_API_KEY))
          })
        ]
      };
    }

    return {
      provider,
      models: rawModels.map((raw, index) => normalizeGeminiModel(raw, observedAt, index)).filter((model): model is ModelOffering => model !== null),
      notices: []
    };
  }
};
