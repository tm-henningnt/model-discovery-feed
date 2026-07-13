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
  toPositiveInt
} from "./shared";

type GitHubModel = {
  id: string;
  name?: string | null;
  publisher?: string | null;
  registry?: string | null;
  summary?: string | null;
  version?: string | null;
  capabilities?: string[] | null;
  limits?: {
    max_input_tokens?: number | null;
    max_output_tokens?: number | null;
  } | null;
  rate_limit_tier?: string | null;
  supported_input_modalities?: string[] | null;
  supported_output_modalities?: string[] | null;
  tags?: string[] | null;
  html_url?: string | null;
  [key: string]: unknown;
};

const provider: Provider = {
  id: "github-models",
  object: "provider",
  name: "GitHub Models",
  homepage: "https://github.com",
  api_protocols: ["github_models"],
  default_base_url: null,
  authentication: {
    type: "api_key",
    header: "Authorization",
    scheme: "Bearer",
    credential_hint: "GITHUB_TOKEN"
  },
  signup: {
    required: true,
    credit_card_required: null
  },
  source_claims: []
};

function normalizeGitHubModel(raw: GitHubModel, observedAt: string, index: number): ModelOffering | null {
  const providerModelId = normalizeText(raw.id);
  if (!providerModelId) {
    return null;
  }

  const name = normalizeText(raw.name) ?? providerModelId;
  const description = normalizeText(raw.summary);
  const capabilityCandidates = new Set<string>(["chat"]);
  const supportedInputModalities = Array.isArray(raw.supported_input_modalities) ? raw.supported_input_modalities : [];
  const supportedOutputModalities = Array.isArray(raw.supported_output_modalities) ? raw.supported_output_modalities : [];
  const rawCapabilities = Array.isArray(raw.capabilities) ? raw.capabilities : [];

  if (rawCapabilities.some((item) => item === "streaming")) {
    capabilityCandidates.add("streaming");
  }
  if (rawCapabilities.some((item) => item === "tool-calling")) {
    capabilityCandidates.add("tool_use");
  }
  if (supportedInputModalities.includes("image") || supportedOutputModalities.includes("image")) {
    capabilityCandidates.add("vision");
  }
  if (hasAnyKeyword(providerModelId, ["coder", "code", "coding"]) || hasAnyKeyword(name, ["coder", "code", "coding"]) || hasAnyKeyword(description ?? "", ["coder", "code", "coding"])) {
    capabilityCandidates.add("coding");
  }
  if (Array.isArray(raw.tags) && raw.tags.some((tag) => tag === "structured-output")) {
    capabilityCandidates.add("structured_output");
  }

  const contextTokens = toPositiveInt(raw.limits?.max_input_tokens);
  const maxOutputTokens = toPositiveInt(raw.limits?.max_output_tokens);
  // `rate_limit_tier` is a request-rate/QoS class, not an availability signal — and its semantics are
  // inverse ("low"-tier models get the *higher* free request allowance). It must not gate availability;
  // it only informs the free-tier quota note below. Listed catalog models are available.
  const rateLimitTier = normalizeText(raw.rate_limit_tier);

  return {
    id: `github-models:${providerModelId}`,
    object: "model_offering",
    display_name: name,
    provider: {
      id: provider.id,
      name: provider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      id: providerModelId,
      confidence: "medium",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description,
    endpoint: {
      protocol: "github_models",
      base_url: null,
      model: providerModelId
    },
    capabilities: cleanCapabilityList(capabilityCandidates),
    limits: {
      context_tokens: contextTokens,
      max_output_tokens: maxOutputTokens
    },
    pricing: {
      // GitHub Models is a free, rate-limited preview by default (with an opt-in paid production tier
      // billed on GitHub's own token-unit scheme). The catalog exposes no per-token price, and any
      // single number would misrepresent it — so carry the free-tier classification with a quota note
      // and leave the per-token fields null. See docs/research/github-models-pricing.md.
      kind: "free_tier",
      input_usd_per_1m_tokens: null,
      output_usd_per_1m_tokens: null,
      currency: null,
      metering: "tokens",
      free: {
        is_currently_free: true,
        basis: "account_free_tier",
        requires_account: true,
        requires_api_key: true,
        requires_credit_card: false,
        quota: rateLimitTier ? `rate-limited (tier: ${rateLimitTier})` : "rate-limited preview",
        expires_at: null,
        last_verified_at: observedAt,
        confidence: "medium"
      }
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
      recommendation_notes: [
        "GitHub Models free preview (rate-limited); production usage is billed per token-unit on GitHub's own pricing scheme, not the model creator's per-token rate."
      ]
    },
    source_claims: [
      claim({
        id: `github-models:${providerModelId}:model:${index}`,
        collector: "github-models",
        sourceUrl: "https://models.github.ai/catalog/models",
        observedAt,
        fieldPaths: [
          "capabilities",
          "limits.context_tokens",
          "limits.max_output_tokens",
          "availability.status",
          "policy.tags"
        ],
        confidence: "high",
        rawReference: {
          snapshot_id: "github-models-live-response",
          json_pointer: `/${index}`,
          provider_model_id: providerModelId,
          html_url: raw.html_url ?? null
        }
      })
    ],
    policy: {
      visibility: "listed",
      tags: Array.from(
        new Set(
          [
            Array.isArray(raw.tags) ? raw.tags.find((tag) => tag === "multipurpose" || tag === "multilingual" || tag === "multimodal") ?? null : null,
            hasAnyKeyword(providerModelId, ["coder", "code", "coding"]) ? "coding" : null
          ].filter((item): item is string => Boolean(item))
        )
      ),
      recommended_for_agentic_workflows: capabilityCandidates.has("tool_use") || capabilityCandidates.has("structured_output") ? true : null
    }
  };
}

export const githubModelsCollector: Collector = {
  id: "github-models",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const observedAt = nowIso(context);
    const response = await fetchJson<GitHubModel[]>(context, "https://models.github.ai/catalog/models", {
      headers: {
        ...(normalizeText(context.env.GITHUB_TOKEN) ? { Authorization: `Bearer ${normalizeText(context.env.GITHUB_TOKEN)}` } : {}),
        ...(normalizeText(context.env.GH_TOKEN) ? { Authorization: `Bearer ${normalizeText(context.env.GH_TOKEN)}` } : {}),
        ...(normalizeText(context.env.GH_MODELS_TOKEN) ? { Authorization: `Bearer ${normalizeText(context.env.GH_MODELS_TOKEN)}` } : {}),
        "X-GitHub-Api-Version": "2026-03-10",
        Accept: "application/vnd.github+json"
      }
    });

    if (!response.ok) {
      return {
        provider,
        models: [],
        notices: [
          collectorNotice("github-models", "collector unavailable", {
            status: response.status,
            error: response.error
          })
        ]
      };
    }

    const models = (Array.isArray(response.data) ? response.data : [])
      .map((raw, index) => normalizeGitHubModel(raw, observedAt, index))
      .filter((model): model is ModelOffering => model !== null);

    return {
      provider,
      models,
      notices: []
    };
  }
};
