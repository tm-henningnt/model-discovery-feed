import type { ModelOffering, Provider } from "../feed/schema";
import type { Collector, CollectorContext, CollectorResult } from "./types";
import {
  accountFreeTierPricing,
  claim,
  cleanCapabilityList,
  collectorNotice,
  fetchJson,
  hasAnyKeyword,
  nowIso,
  normalizeText,
  tokenPricing,
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

const CLINE_PASS_PREFIX = "cline-pass/";
const CLINE_FREE_PREFIX = "cline-free/";

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
  reasoningMandatory: boolean | null | undefined
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
  return capabilities;
}

function catalogOutputModalities(raw: ClineCatalogModel): string[] {
  return raw.architecture && Array.isArray(raw.architecture.output_modalities) ? raw.architecture.output_modalities : [];
}

function catalogCapabilities(raw: ClineCatalogModel): Set<string> {
  const supportedParameters = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const inputModalities = raw.architecture && Array.isArray(raw.architecture.input_modalities) ? raw.architecture.input_modalities : [];
  return deriveCapabilities(supportedParameters, inputModalities, catalogOutputModalities(raw), raw.reasoning?.mandatory);
}

function normalizeClineCatalogModel(
  raw: ClineCatalogModel,
  freeRosterIds: Set<string>,
  observedAt: string,
  index: number
): ModelOffering | null {
  const providerModelId = normalizeText(raw.id);
  if (!providerModelId) {
    return null;
  }

  const name = normalizeText(raw.name) ?? providerModelId;
  const description = normalizeText(raw.description);
  const contextTokens = toPositiveInt(raw.context_length);
  const maxOutputTokens = toPositiveInt(raw.top_provider?.max_completion_tokens);
  const capabilities = catalogCapabilities(raw);

  // Cline resells OpenRouter's catalog, so a zero rate in the catalog is OpenRouter's price and not
  // proof that Cline serves the model free. Only Cline's own `free[]` roster settles that, so a
  // catalog-derived free claim carries low confidence (ADR 0013).
  const sellerConfirmedFree = freeRosterIds.has(providerModelId);
  const promptPrice = usdPerMillionTokens(raw.pricing?.prompt);
  const completionPrice = usdPerMillionTokens(raw.pricing?.completion);
  const pricing = sellerConfirmedFree
    ? accountFreeTierPricing(observedAt)
    : tokenPricing({
        prompt: raw.pricing?.prompt,
        completion: raw.pricing?.completion,
        outputModalities: catalogOutputModalities(raw),
        expiresAt: raw.expiration_date,
        observedAt,
        freeConfidence: "low"
      });

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
      model: providerModelId,
      protocol_options: {
        response_envelope_key: "data"
      }
    },
    capabilities: cleanCapabilityList(capabilities),
    limits: {
      context_tokens: contextTokens,
      max_output_tokens: maxOutputTokens
    },
    pricing,
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
          provider_model_id: providerModelId,
          // Cline's free tier bills nothing, so the offering publishes 0. Keep the catalog's
          // pay-as-you-go rate here: it states what the same model costs without the tier.
          ...(sellerConfirmedFree
            ? {
                free_roster_source_url: RECOMMENDED_URL,
                catalog_input_usd_per_1m_tokens: promptPrice,
                catalog_output_usd_per_1m_tokens: completionPrice
              }
            : {})
        }
      })
    ],
    policy: {
      visibility: "listed",
      tags: Array.from(
        new Set(
          [
            pricing.kind === "free" ? "free" : null,
            hasAnyKeyword(name, ["reasoning"]) ? "reasoning" : null
          ].filter((item): item is string => Boolean(item))
        )
      ),
      recommended_for_agentic_workflows: capabilities.has("tool_use") || capabilities.has("structured_output") ? true : null
    }
  };
}

// A roster slug carries a Cline-owned namespace prefix (`cline-pass/`, `cline-free/`) that the catalog
// does not use. Strip it to recover the slug the catalog can be searched by.
function bareSlug(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

// Match a ClinePass roster slug (e.g. `glm-5.2`) to its full catalog entry (`z-ai/glm-5.2`). The
// catalog carries the pricing/context/capabilities the roster lacks (ADR 0006).
function findCatalogMatch(slug: string, catalog: ClineCatalogModel[]): ClineCatalogModel | null {
  // Strip any variant suffix on the roster side too, so the join is symmetric with the catalog side.
  const target = canonicalSlug(slug).toLowerCase();
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

interface RosterJoin {
  match: ClineCatalogModel | null;
  displayName: string;
  description: string | null;
  rosterDescription: string | null;
  contextTokens: number | null;
  maxOutputTokens: number | null;
  capabilities: Set<string>;
  canonicalId: string;
  canonicalConfidence: "high" | "medium";
}

// Enrich a roster entry from its catalog match. The roster publishes an id and a blurb; the catalog
// carries the name, context, capabilities and rate (ADR 0006).
function joinRosterEntry(
  entry: ClineRosterEntry,
  providerModelId: string,
  prefix: string,
  catalog: ClineCatalogModel[]
): RosterJoin {
  const slug = bareSlug(providerModelId, prefix);
  const match = findCatalogMatch(slug, catalog);
  const rosterDescription = normalizeText(entry.description);

  return {
    match,
    // The roster `name` is just the prefixed slug, so it is no better than the bare slug as a display
    // name — only the catalog match carries a human-readable name.
    displayName: (match && normalizeText(match.name)) ?? slug,
    description: (match && normalizeText(match.description)) ?? rosterDescription,
    rosterDescription,
    contextTokens: match ? toPositiveInt(match.context_length) : null,
    maxOutputTokens: match ? toPositiveInt(match.top_provider?.max_completion_tokens) : null,
    capabilities: match ? catalogCapabilities(match) : new Set<string>(["chat", "streaming", "tool_use"]),
    canonicalId: match ? canonicalSlug(normalizeText(match.id) ?? slug) : providerModelId,
    canonicalConfidence: match ? "high" : "medium"
  };
}

// A `free[]` roster entry in Cline's own `cline-free/` namespace has no catalog entry of its own, so
// the offering exists only here. Cline states it is free, which is the strongest claim available
// (ADR 0013).
function normalizeClineFreeRosterModel(
  entry: ClineRosterEntry,
  catalog: ClineCatalogModel[],
  observedAt: string,
  index: number
): ModelOffering | null {
  const providerModelId = normalizeText(entry.id);
  if (!providerModelId) {
    return null;
  }

  const join = joinRosterEntry(entry, providerModelId, CLINE_FREE_PREFIX, catalog);

  return {
    id: `cline:${providerModelId}`,
    object: "model_offering",
    display_name: join.displayName,
    provider: {
      id: clineProvider.id,
      name: clineProvider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      id: join.canonicalId,
      confidence: join.canonicalConfidence,
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description: join.description,
    endpoint: {
      protocol: "openai_chat_completions",
      base_url: clineProvider.default_base_url,
      model: providerModelId,
      protocol_options: {
        response_envelope_key: "data"
      }
    },
    capabilities: cleanCapabilityList(join.capabilities),
    limits: {
      context_tokens: join.contextTokens,
      max_output_tokens: join.maxOutputTokens
    },
    pricing: accountFreeTierPricing(observedAt),
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
      recommendation_notes: join.rosterDescription ? [join.rosterDescription] : []
    },
    source_claims: [
      claim({
        id: `cline:${providerModelId}:free-roster:${index}`,
        collector: "cline",
        sourceUrl: RECOMMENDED_URL,
        observedAt,
        fieldPaths: ["endpoint.model", "pricing.kind", "pricing.free.basis"],
        confidence: "high",
        rawReference: {
          snapshot_id: "cline-recommended-live-response",
          json_pointer: `/free/${index}`,
          provider_model_id: providerModelId
        }
      }),
      ...(join.match
        ? [
            claim({
              id: `cline:${providerModelId}:catalog-join:${index}`,
              collector: "cline",
              sourceUrl: CATALOG_URL,
              observedAt,
              fieldPaths: [
                "canonical_model.id",
                "display_name",
                "limits.context_tokens",
                "limits.max_output_tokens",
                "capabilities"
              ],
              confidence: "high",
              rawReference: {
                snapshot_id: "cline-live-response",
                provider_model_id: providerModelId,
                matched_catalog_id: normalizeText(join.match.id)
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
            "free",
            hasAnyKeyword(join.displayName, ["reasoning"]) ? "reasoning" : null
          ].filter((item): item is string => Boolean(item))
        )
      ),
      recommended_for_agentic_workflows:
        join.capabilities.has("tool_use") || join.capabilities.has("structured_output") ? true : null
    }
  };
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

  const join = joinRosterEntry(entry, providerModelId, CLINE_PASS_PREFIX, catalog);
  const { match, displayName, description, rosterDescription, contextTokens, maxOutputTokens, capabilities } = join;
  const { canonicalId, canonicalConfidence } = join;

  // ClinePass is a flat monthly subscription — never billed per token. The underlying model's
  // pay-as-you-go rate is carried only as a cheap-vs-expensive signal (ADR 0006).
  const referenceInput = match ? usdPerMillionTokens(match.pricing?.prompt) : null;
  const referenceOutput = match ? usdPerMillionTokens(match.pricing?.completion) : null;
  const hasReferenceRate = referenceInput !== null || referenceOutput !== null;

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
      model: providerModelId,
      protocol_options: {
        response_envelope_key: "data"
      }
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
    const headers = authHeaders(context);
    // The catalog states what Cline serves; the roster states which of those Cline serves free. The
    // roster is the smaller read by two orders of magnitude, so both are fetched every run.
    const [response, roster] = await Promise.all([
      fetchJson<ClineCatalogResponse>(context, CATALOG_URL, { headers }),
      fetchJson<ClineRecommendedResponse>(context, RECOMMENDED_URL, { headers })
    ]);

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

    // Without the roster, no free claim can be confirmed against Cline's own billing. The catalog
    // still publishes, and every zero-priced offering degrades to low confidence.
    const rosterEntries = roster.ok && Array.isArray(roster.data.free) ? roster.data.free : [];
    const notices = roster.ok
      ? []
      : [
          collectorNotice("cline", "free roster unavailable; zero-priced offerings degraded to low confidence", {
            status: roster.status,
            error: roster.error
          })
        ];

    const catalogModels = Array.isArray(response.data.data) ? response.data.data : [];
    const catalogIds = new Set(
      catalogModels.map((raw) => normalizeText(raw.id)).filter((id): id is string => id !== null)
    );
    const freeRosterIds = new Set(
      rosterEntries.map((entry) => normalizeText(entry.id)).filter((id): id is string => id !== null)
    );

    const models = catalogModels
      .map((raw, index) => normalizeClineCatalogModel(raw, freeRosterIds, observedAt, index))
      .filter((model): model is ModelOffering => model !== null);

    // A roster id the catalog does not list is still a callable offering — Cline's own `cline-free/`
    // namespace never appears in the resold catalog.
    const rosterOnlyModels = rosterEntries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        const id = normalizeText(entry.id);
        return id !== null && !catalogIds.has(id);
      })
      .map(({ entry, index }) => normalizeClineFreeRosterModel(entry, catalogModels, observedAt, index))
      .filter((model): model is ModelOffering => model !== null);

    return {
      provider: clineProvider,
      models: [...models, ...rosterOnlyModels],
      notices
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
