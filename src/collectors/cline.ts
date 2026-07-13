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

// Cline resells inference in OpenRouter's `/models` schema and slug namespace, so a catalog entry is
// shaped exactly like an OpenRouter model. See ADR 0006.
type ClineCatalogModel = {
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

type ClineCatalogResponse = {
  data?: ClineCatalogModel[];
};

type ClineRosterEntry = {
  id: string;
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
  [key: string]: unknown;
};

type ClineRecommendedResponse = {
  recommended?: ClineRosterEntry[] | null;
  free?: ClineRosterEntry[] | null;
  clinePass?: ClineRosterEntry[] | null;
};

const BASE_URL = "https://api.cline.bot/api/v1";
const CATALOG_URL = `${BASE_URL}/ai/cline/models`;
const RECOMMENDED_URL = `${BASE_URL}/ai/cline/recommended-models`;

const clineProvider: Provider = {
  id: "cline",
  object: "provider",
  name: "Cline",
  homepage: "https://cline.bot",
  api_protocols: ["openai_chat_completions"],
  default_base_url: BASE_URL,
  authentication: {
    type: "api_key",
    header: "Authorization",
    scheme: "Bearer",
    credential_hint: "CLINE_API_KEY"
  },
  signup: {
    required: true,
    credit_card_required: null
  },
  source_claims: []
};

const clinePassProvider: Provider = {
  id: "cline-pass",
  object: "provider",
  name: "ClinePass",
  homepage: "https://docs.cline.bot/getting-started/clinepass",
  api_protocols: ["openai_chat_completions"],
  default_base_url: BASE_URL,
  authentication: {
    type: "api_key",
    header: "Authorization",
    scheme: "Bearer",
    credential_hint: "CLINE_API_KEY"
  },
  signup: {
    required: true,
    credit_card_required: null
  },
  source_claims: []
};

// Strip an OpenRouter variant suffix (`:free`, `:thinking`, …) to recover the canonical creator/model
// slug (ADR 0003). Cline catalog `canonical_slug` values carry date suffixes, so the id is the
// cleaner canonical source.
function canonicalSlug(id: string): string {
  return id.split(":")[0];
}

function deriveCapabilities(
  supportedParameters: string[],
  inputModalities: string[],
  outputModalities: string[],
  reasoningMandatory: boolean | null | undefined,
  id: string,
  name: string,
  description: string | null
): Set<string> {
  const capabilities = new Set<string>(["chat", "streaming"]);
  if (supportedParameters.some((item) => ["tools", "tool_choice"].includes(item))) {
    capabilities.add("tool_use");
  }
  if (supportedParameters.includes("response_format")) {
    capabilities.add("structured_output");
  }
  if (supportedParameters.some((item) => item === "reasoning" || item === "include_reasoning") || reasoningMandatory) {
    capabilities.add("reasoning");
  }
  if (inputModalities.some((item) => item === "image") || outputModalities.some((item) => item === "image")) {
    capabilities.add("vision");
  }
  if (hasAnyKeyword(id, ["coder", "code", "coding"]) || hasAnyKeyword(name, ["coder", "code", "coding"]) || hasAnyKeyword(description ?? "", ["coder", "code", "coding"])) {
    capabilities.add("coding");
  }
  return capabilities;
}

function catalogCapabilities(raw: ClineCatalogModel, name: string, description: string | null): Set<string> {
  const supportedParameters = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const inputModalities = raw.architecture && Array.isArray(raw.architecture.input_modalities) ? raw.architecture.input_modalities : [];
  const outputModalities = raw.architecture && Array.isArray(raw.architecture.output_modalities) ? raw.architecture.output_modalities : [];
  return deriveCapabilities(supportedParameters, inputModalities, outputModalities, raw.reasoning?.mandatory, raw.id, name, description);
}

function normalizeClineCatalogModel(raw: ClineCatalogModel, observedAt: string, index: number): ModelOffering | null {
  const providerModelId = normalizeText(raw.id);
  if (!providerModelId) {
    return null;
  }

  const name = normalizeText(raw.name) ?? providerModelId;
  const description = normalizeText(raw.description);
  const contextTokens = toPositiveInt(raw.context_length);
  const maxOutputTokens = toPositiveInt(raw.top_provider?.max_completion_tokens);
  const capabilities = catalogCapabilities(raw, name, description);

  const promptPrice = usdPerMillionTokens(raw.pricing?.prompt);
  const completionPrice = usdPerMillionTokens(raw.pricing?.completion);
  const isFree = promptPrice === 0 && completionPrice === 0;
  const pricingKind = isFree ? "free" : promptPrice === null || completionPrice === null ? "unknown" : "paid";

  return {
    id: `cline:${providerModelId}`,
    object: "model_offering",
    display_name: name,
    provider: {
      id: clineProvider.id,
      name: clineProvider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      // Cline serves the OpenRouter catalog under OpenRouter slugs, so the join is exact — high
      // confidence lets ADR 0004 propagate scores onto these offerings.
      id: canonicalSlug(providerModelId),
      confidence: "high",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description,
    endpoint: {
      protocol: "openai_chat_completions",
      base_url: clineProvider.default_base_url,
      model: providerModelId
    },
    capabilities: cleanCapabilityList(capabilities),
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
      agentic_score: null,
      speed_score: null,
      benchmarks: null,
      recommendation_notes: []
    },
    source_claims: [
      claim({
        id: `cline:${providerModelId}:model:${index}`,
        collector: "cline",
        sourceUrl: CATALOG_URL,
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
          snapshot_id: "cline-live-response",
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
      recommended_for_agentic_workflows: capabilities.has("tool_use") || capabilities.has("structured_output") ? true : null
    }
  };
}

function clinePassBareSlug(id: string): string {
  return id.startsWith("cline-pass/") ? id.slice("cline-pass/".length) : id;
}

// Match a ClinePass roster slug (e.g. `glm-5.2`) to its full catalog entry (`z-ai/glm-5.2`). The
// catalog carries the pricing/context/capabilities the roster lacks (ADR 0006).
function findCatalogMatch(bareSlug: string, catalog: ClineCatalogModel[]): ClineCatalogModel | null {
  // Strip any variant suffix on the roster side too, so the join is symmetric with the catalog side.
  const target = canonicalSlug(bareSlug).toLowerCase();
  const baseOf = (model: ClineCatalogModel) => canonicalSlug(normalizeText(model.id) ?? "").toLowerCase();

  const matches = catalog.filter((model) => {
    const base = baseOf(model);
    return base === target || base.endsWith(`/${target}`);
  });
  if (matches.length === 0) {
    return null;
  }

  // Prefer an exact base match over a looser path-suffix match.
  const exact = matches.filter((model) => baseOf(model) === target);
  const pool = exact.length > 0 ? exact : matches;

  // Refuse an ambiguous join: if the pool spans more than one distinct underlying slug (two creators
  // sharing a model segment), binding either would be the distinct-to-one mapping ADR 0003 forbids —
  // at high confidence, no less. Return null so the offering degrades to a medium-confidence echo.
  const distinctBases = new Set(pool.map(baseOf));
  if (distinctBases.size > 1) {
    return null;
  }

  // One underlying model, possibly several variants — prefer the suffix-free (non-`:variant`) entry so
  // a `:free` sibling never shadows the paid reference rate.
  return pool.find((model) => !(normalizeText(model.id) ?? "").includes(":")) ?? pool[0];
}

function normalizeClinePassModel(
  entry: ClineRosterEntry,
  catalog: ClineCatalogModel[],
  observedAt: string,
  index: number
): ModelOffering | null {
  const providerModelId = normalizeText(entry.id);
  if (!providerModelId) {
    return null;
  }

  const bareSlug = clinePassBareSlug(providerModelId);
  const match = findCatalogMatch(bareSlug, catalog);
  const rosterDescription = normalizeText(entry.description);

  // The roster `name` is just the `cline-pass/…` slug, so it is no better than the bare slug as a
  // display name — only the catalog match carries a human-readable name.
  const displayName = (match && normalizeText(match.name)) ?? bareSlug;
  const description = (match && normalizeText(match.description)) ?? rosterDescription;
  const contextTokens = match ? toPositiveInt(match.context_length) : null;
  const maxOutputTokens = match ? toPositiveInt(match.top_provider?.max_completion_tokens) : null;
  const capabilities = match
    ? catalogCapabilities(match, displayName, description)
    : new Set<string>(["chat", "streaming", "tool_use"]);

  // ClinePass is a flat monthly subscription — never billed per token. The underlying model's
  // pay-as-you-go rate is carried only as a cheap-vs-expensive signal (ADR 0006).
  const referenceInput = match ? usdPerMillionTokens(match.pricing?.prompt) : null;
  const referenceOutput = match ? usdPerMillionTokens(match.pricing?.completion) : null;
  const hasReferenceRate = referenceInput !== null || referenceOutput !== null;

  const canonicalId = match ? canonicalSlug(normalizeText(match.id) ?? bareSlug) : providerModelId;
  const canonicalConfidence = match ? "high" : "medium";

  return {
    id: `cline-pass:${providerModelId}`,
    object: "model_offering",
    display_name: displayName,
    provider: {
      id: clinePassProvider.id,
      name: clinePassProvider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      id: canonicalId,
      confidence: canonicalConfidence,
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description,
    endpoint: {
      protocol: "openai_chat_completions",
      base_url: clinePassProvider.default_base_url,
      model: providerModelId
    },
    capabilities: cleanCapabilityList(capabilities),
    limits: {
      context_tokens: contextTokens,
      max_output_tokens: maxOutputTokens
    },
    pricing: {
      kind: "subscription_included",
      input_usd_per_1m_tokens: referenceInput,
      output_usd_per_1m_tokens: referenceOutput,
      currency: hasReferenceRate ? "USD" : null,
      metering: "tokens",
      free: null,
      subscription: {
        billing: "flat_monthly",
        per_token_billed: false,
        // Reference rates are the underlying model's pay-as-you-go price, not an amount billed.
        reference_pricing: true,
        quota_multiplier_vs_payg: "2-5x"
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
      recommendation_notes: rosterDescription ? [rosterDescription] : []
    },
    source_claims: [
      claim({
        id: `cline-pass:${providerModelId}:roster:${index}`,
        collector: "cline-pass",
        sourceUrl: RECOMMENDED_URL,
        observedAt,
        fieldPaths: ["endpoint.model", "pricing.kind"],
        confidence: "high",
        rawReference: {
          snapshot_id: "cline-recommended-live-response",
          json_pointer: `/clinePass/${index}`,
          provider_model_id: providerModelId
        }
      }),
      // Only cite the catalog as a source when a join actually happened — otherwise these fields came
      // from the roster fallback or are null, and attributing them to the catalog would be false.
      ...(match
        ? [
            claim({
              id: `cline-pass:${providerModelId}:catalog-join:${index}`,
              collector: "cline-pass",
              sourceUrl: CATALOG_URL,
              observedAt,
              fieldPaths: [
                "canonical_model.id",
                "display_name",
                "limits.context_tokens",
                "limits.max_output_tokens",
                "capabilities",
                "pricing.input_usd_per_1m_tokens",
                "pricing.output_usd_per_1m_tokens"
              ],
              confidence: "high",
              rawReference: {
                snapshot_id: "cline-live-response",
                provider_model_id: providerModelId,
                matched_catalog_id: normalizeText(match.id)
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
            hasAnyKeyword(providerModelId, ["coder", "code", "coding"]) ? "coding" : null,
            hasAnyKeyword(displayName, ["reasoning"]) ? "reasoning" : null
          ].filter((item): item is string => Boolean(item))
        )
      ),
      recommended_for_agentic_workflows: capabilities.has("tool_use") || capabilities.has("structured_output") ? true : null
    }
  };
}

function authHeaders(context: CollectorContext): Record<string, string> {
  const apiKey = normalizeText(context.env.CLINE_API_KEY);
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export const clineCollector: Collector = {
  id: "cline",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const observedAt = nowIso(context);
    const response = await fetchJson<ClineCatalogResponse>(context, CATALOG_URL, {
      headers: authHeaders(context)
    });

    if (!response.ok) {
      return {
        provider: clineProvider,
        models: [],
        notices: [
          collectorNotice("cline", "collector unavailable", {
            status: response.status,
            error: response.error
          })
        ]
      };
    }

    const models = (Array.isArray(response.data.data) ? response.data.data : [])
      .map((raw, index) => normalizeClineCatalogModel(raw, observedAt, index))
      .filter((model): model is ModelOffering => model !== null);

    return {
      provider: clineProvider,
      models,
      notices: []
    };
  }
};

export const clinePassCollector: Collector = {
  id: "cline-pass",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const observedAt = nowIso(context);
    const headers = authHeaders(context);
    const [roster, catalog] = await Promise.all([
      fetchJson<ClineRecommendedResponse>(context, RECOMMENDED_URL, { headers }),
      fetchJson<ClineCatalogResponse>(context, CATALOG_URL, { headers })
    ]);

    if (!roster.ok) {
      return {
        provider: clinePassProvider,
        models: [],
        notices: [
          collectorNotice("cline-pass", "collector unavailable", {
            status: roster.status,
            error: roster.error
          })
        ]
      };
    }

    const catalogModels = catalog.ok && Array.isArray(catalog.data.data) ? catalog.data.data : [];
    const notices = catalog.ok
      ? []
      : [
          collectorNotice("cline-pass", "catalog join unavailable; roster enriched with roster-only fields", {
            status: catalog.status,
            error: catalog.error
          })
        ];

    const rosterEntries = Array.isArray(roster.data.clinePass) ? roster.data.clinePass : [];
    const models = rosterEntries
      .map((entry, index) => normalizeClinePassModel(entry, catalogModels, observedAt, index))
      .filter((model): model is ModelOffering => model !== null);

    return {
      provider: clinePassProvider,
      models,
      notices
    };
  }
};
