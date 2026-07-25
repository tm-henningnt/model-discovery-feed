import type { Capability, EndpointProtocol, ModelOffering, Provider } from "../feed/schema";
import type { Collector, CollectorContext, CollectorNotice, CollectorResult } from "./types";
import {
  claim,
  cleanCapabilityList,
  collectorNotice,
  fetchJson,
  fetchText,
  hasAnyKeyword,
  nowIso,
  normalizeText
} from "./shared";

// QwenCloud publishes no unauthenticated model-catalog API. Its marketplace reads a public CDN
// mapping of marketplace model id -> internal offering id, and its docs publish pay-as-you-go rates
// and the Token Plan roster as Markdown. See ADR 0007 and docs/research/qwencloud-models-source.md.
export const MODEL_MAPPING_URL = "https://alioth-intl.alicdn.com/model-mapping";
export const PRICING_DOC_URL = "https://docs.qwencloud.com/developer-guides/getting-started/pricing.md";
export const TOKEN_PLAN_PERSONAL_DOC_URL =
  "https://docs.qwencloud.com/token-plan/personal/token-plan-personal-overview.md";
export const TOKEN_PLAN_TEAM_DOC_URL =
  "https://docs.qwencloud.com/token-plan/team/token-plan-team-overview.md";

const MARKETPLACE_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const TOKEN_PLAN_BASE_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const MODEL_PAGE_BASE = "https://www.qwencloud.com/models";
const STALE_AFTER_SECONDS = 86400;

type ModelMappingResponse = Record<string, unknown>;

type TokenPlanEdition = "personal" | "team";

type TokenPlanEntry = {
  modelId: string;
  brand: string | null;
  capabilityText: string | null;
  editions: TokenPlanEdition[];
};

type TokenRate = {
  input: number | null;
  output: number | null;
  tierBasis: string | null;
};

/**
 * The modality class a marketplace model id belongs to. QwenCloud sells text, vision, image, video,
 * speech, and embedding models through one marketplace but bills and serves each differently, so the
 * class drives capabilities, metering, and endpoint protocol.
 */
type ModelClass =
  | "text"
  | "vision"
  | "omni"
  | "image"
  | "video"
  | "speech_to_text"
  | "text_to_speech"
  | "embedding"
  | "rerank";

const qwencloudProvider: Provider = {
  id: "qwencloud",
  object: "provider",
  name: "QwenCloud",
  homepage: "https://www.qwencloud.com",
  api_protocols: ["openai_chat_completions", "openai_responses", "anthropic_messages"],
  default_base_url: MARKETPLACE_BASE_URL,
  authentication: {
    type: "api_key",
    header: "Authorization",
    scheme: "Bearer",
    credential_hint: "DASHSCOPE_API_KEY"
  },
  signup: {
    required: true,
    credit_card_required: null
  },
  source_claims: []
};

const qwencloudTokenPlanProvider: Provider = {
  id: "qwencloud-token-plan",
  object: "provider",
  name: "QwenCloud Token Plan",
  homepage: "https://www.qwencloud.com/pricing/token-plan",
  api_protocols: ["openai_chat_completions", "anthropic_messages"],
  default_base_url: TOKEN_PLAN_BASE_URL,
  authentication: {
    type: "api_key",
    header: "Authorization",
    scheme: "Bearer",
    // Token Plan keys are a separate `sk-sp-` namespace from pay-as-you-go `sk-` keys.
    credential_hint: "QWEN_TOKEN_PLAN_API_KEY"
  },
  signup: {
    required: true,
    credit_card_required: true
  },
  source_claims: []
};

function classifyModel(modelId: string): ModelClass {
  const id = modelId.toLowerCase();

  if (id.includes("rerank")) return "rerank";
  if (id.includes("embedding")) return "embedding";
  if (id.includes("asr")) return "speech_to_text";
  if (id.includes("tts") || id.includes("cosyvoice")) return "text_to_speech";
  if (id.includes("omni")) return "omni";
  if (/-(t2v|i2v|r2v|s2v|kf2v)\b/.test(id) || id.includes("video") || id.includes("animate") || id.includes("vace")) {
    return "video";
  }
  if (/-(t2i|i2i)\b/.test(id) || id.includes("image")) return "image";
  if (id.includes("-vl") || id.includes("qvq") || id.includes("ocr")) return "vision";
  return "text";
}

function capabilitiesForClass(modelClass: ModelClass, modelId: string): Capability[] {
  const coding = hasAnyKeyword(modelId, ["coder", "code", "coding"]) ? (["coding"] as Capability[]) : [];

  switch (modelClass) {
    case "text":
      return cleanCapabilityList(["chat", "streaming", ...coding]);
    case "vision":
      return cleanCapabilityList(["chat", "streaming", "vision", ...coding]);
    case "omni":
      return cleanCapabilityList(["chat", "streaming", "vision", "speech_to_text", "text_to_speech"]);
    case "image":
      return cleanCapabilityList(["image_generation"]);
    case "speech_to_text":
      return cleanCapabilityList(["speech_to_text"]);
    case "text_to_speech":
      return cleanCapabilityList(["text_to_speech"]);
    case "embedding":
      return cleanCapabilityList(["embeddings"]);
    case "rerank":
      return cleanCapabilityList(["reranking"]);
    case "video":
      // The capability enum has no video term, so a video model carries a policy tag instead.
      return [];
    default:
      return [];
  }
}

function meteringForClass(modelClass: ModelClass): string {
  switch (modelClass) {
    case "image":
      return "images";
    case "video":
      return "video_seconds";
    case "text_to_speech":
      return "characters";
    case "speech_to_text":
      return "audio_seconds";
    default:
      return "tokens";
  }
}

// `openai_chat_completions` names one exact protocol. Image, video, speech, and embedding models are
// served by different DashScope shapes (async task submission, `/audio/*`, `/embeddings`), so their
// protocol is `unknown` rather than a chat-completions claim that would not work.
function protocolForClass(modelClass: ModelClass): EndpointProtocol {
  return modelClass === "text" || modelClass === "vision" || modelClass === "omni"
    ? "openai_chat_completions"
    : "unknown";
}

function classTag(modelClass: ModelClass): string | null {
  switch (modelClass) {
    case "image":
      return "image-generation";
    case "video":
      return "video-generation";
    case "speech_to_text":
      return "speech-to-text";
    case "text_to_speech":
      return "text-to-speech";
    case "embedding":
      return "embeddings";
    case "rerank":
      return "reranking";
    default:
      return null;
  }
}

export type MarkdownTable = {
  headers: string[];
  rows: string[][];
};

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && line.includes("-");
}

/** Extracts every GitHub-flavoured Markdown table in document order. */
export function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith("|") || !isSeparatorRow(lines[index + 1])) {
      continue;
    }

    const headers = splitRow(line);
    const rows: string[][] = [];
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].trim().startsWith("|")) {
      rows.push(splitRow(lines[cursor]));
      cursor += 1;
    }

    tables.push({ headers, rows });
    index = cursor - 1;
  }

  return tables;
}

function headerIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header.toLowerCase()));
}

function parseUsdCell(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  // Docs escape the dollar sign for MDX (`\$2.50`) and sometimes carry a trailing note.
  const match = value.replace(/\\/g, "").match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads per-million-token rates out of the pay-as-you-go pricing doc. A model with tiered pricing
 * spans several rows, the first of which is the lowest input band; only that base row becomes the
 * headline rate, and its band label is kept so a consumer can see what the rate is conditioned on.
 */
export function parseTokenRates(markdown: string): Map<string, TokenRate> {
  const rates = new Map<string, TokenRate>();

  for (const table of parseMarkdownTables(markdown)) {
    const modelColumn = headerIndex(table.headers, ["model"]);
    if (modelColumn === -1) {
      continue;
    }

    const inputColumn = headerIndex(table.headers, ["input"]);
    const outputColumn = headerIndex(table.headers, ["output"]);
    const singleRateColumn = headerIndex(table.headers, ["price per 1m tokens"]);
    const tierColumn = headerIndex(table.headers, ["input per request"]);

    const usesTokenRates = (inputColumn !== -1 && outputColumn !== -1) || singleRateColumn !== -1;
    if (!usesTokenRates) {
      continue;
    }

    for (const row of table.rows) {
      const modelId = normalizeText(row[modelColumn]);
      if (!modelId || rates.has(modelId)) {
        continue;
      }

      const input = singleRateColumn !== -1 ? parseUsdCell(row[singleRateColumn]) : parseUsdCell(row[inputColumn]);
      const output = singleRateColumn !== -1 ? null : parseUsdCell(row[outputColumn]);
      if (input === null && output === null) {
        continue;
      }

      rates.set(modelId, {
        input,
        output,
        tierBasis: tierColumn === -1 ? null : normalizeText(row[tierColumn])
      });
    }
  }

  return rates;
}

/**
 * Reads a Token Plan edition roster. The docs table is an exact-string allowlist — the only source
 * that separates the Personal roster from the larger Team roster — so the model id is taken verbatim.
 */
export function parseTokenPlanRoster(markdown: string): Array<{ modelId: string; brand: string | null; capabilityText: string | null }> {
  for (const table of parseMarkdownTables(markdown)) {
    const brandColumn = headerIndex(table.headers, ["brand"]);
    const modelColumn = headerIndex(table.headers, ["model", "model id"]);
    if (brandColumn === -1 || modelColumn === -1) {
      continue;
    }

    const capabilityColumn = headerIndex(table.headers, ["capability", "capabilities"]);
    const entries = table.rows
      .map((row) => ({
        modelId: normalizeText(row[modelColumn]),
        brand: normalizeText(row[brandColumn]),
        capabilityText: capabilityColumn === -1 ? null : normalizeText(row[capabilityColumn])
      }))
      .filter((entry): entry is { modelId: string; brand: string | null; capabilityText: string | null } =>
        entry.modelId !== null
      );

    if (entries.length > 0) {
      return entries;
    }
  }

  return [];
}

function capabilitiesFromDocText(capabilityText: string | null, modelId: string, fallback: ModelClass): Capability[] {
  if (!capabilityText) {
    return capabilitiesForClass(fallback, modelId);
  }

  const text = capabilityText.toLowerCase();
  const capabilities: Capability[] = [];
  if (text.includes("text generation")) {
    capabilities.push("chat", "streaming");
  }
  if (text.includes("reasoning")) {
    capabilities.push("reasoning");
  }
  if (text.includes("visual understanding") || text.includes("vision understanding")) {
    capabilities.push("vision");
  }
  if (text.includes("image generation")) {
    capabilities.push("image_generation");
  }
  if (hasAnyKeyword(modelId, ["coder", "code", "coding"])) {
    capabilities.push("coding");
  }

  return capabilities.length > 0 ? cleanCapabilityList(capabilities) : capabilitiesForClass(fallback, modelId);
}

function displayNameFor(modelId: string, brand: string | null): string {
  const spelled = modelId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => (/^[0-9]/.test(part) ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");

  return brand && !spelled.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${spelled}` : spelled;
}

function modelPageUrl(modelId: string): string {
  return `${MODEL_PAGE_BASE}/${encodeURIComponent(modelId)}`;
}

function normalizeMarketplaceModel(
  modelId: string,
  internalId: string | null,
  rate: TokenRate | undefined,
  observedAt: string
): ModelOffering {
  const modelClass = classifyModel(modelId);
  const capabilities = capabilitiesForClass(modelClass, modelId);
  const protocol = protocolForClass(modelClass);
  const metering = meteringForClass(modelClass);
  const hasRate = rate !== undefined && (rate.input !== null || rate.output !== null);
  const tag = classTag(modelClass);
  // An offering billed per image, per second, or per character is known to be paid, but the contract
  // carries only per-1M-token rate fields — so state `paid` with null rates and let `metering` say
  // which unit applies. A token-billed model with no documented rate stays `unknown` so the
  // models.dev gap-fill can complete it.
  const kind = hasRate ? "paid" : metering === "tokens" ? "unknown" : "paid";

  return {
    id: `qwencloud:${modelId}`,
    object: "model_offering",
    display_name: displayNameFor(modelId, null),
    provider: {
      id: qwencloudProvider.id,
      name: qwencloudProvider.name
    },
    provider_model_id: modelId,
    canonical_model: {
      // The marketplace id carries no creator prefix. Canonicalization binds it to an OpenRouter slug
      // when exactly one live slug shares this model segment (ADR 0003/0007); until then it is an echo.
      id: modelId,
      confidence: "medium",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description: null,
    endpoint: {
      protocol,
      base_url: protocol === "openai_chat_completions" ? MARKETPLACE_BASE_URL : null,
      model: modelId
    },
    capabilities,
    limits: {
      context_tokens: null,
      max_output_tokens: null
    },
    pricing: {
      // Rates exist only for the models the pricing doc lists; a token-billed model without one stays
      // unknown for the models.dev gap-fill to complete (plan 030 never overwrites a non-null
      // first-party rate).
      kind,
      input_usd_per_1m_tokens: rate?.input ?? null,
      output_usd_per_1m_tokens: rate?.output ?? null,
      currency: kind === "paid" ? "USD" : null,
      metering,
      free: null,
      ...(rate?.tierBasis ? { tier_basis: rate.tierBasis } : {})
    },
    availability: {
      status: "available",
      last_checked_at: observedAt,
      last_success_at: observedAt,
      stale_after_seconds: STALE_AFTER_SECONDS
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
        id: `qwencloud:${modelId}:catalog`,
        collector: "qwencloud",
        sourceType: "catalog_page",
        sourceUrl: MODEL_MAPPING_URL,
        observedAt,
        fieldPaths: ["provider_model_id", "endpoint.model", "availability.status"],
        confidence: "high",
        rawReference: {
          snapshot_id: "qwencloud-model-mapping-live-response",
          json_pointer: `/${modelId.replace(/~/g, "~0").replace(/\//g, "~1")}`,
          provider_model_id: modelId,
          internal_model_id: internalId,
          model_page: modelPageUrl(modelId)
        }
      }),
      ...(hasRate
        ? [
            claim({
              id: `qwencloud:${modelId}:pricing-doc`,
              collector: "qwencloud",
              sourceType: "pricing_page",
              sourceUrl: PRICING_DOC_URL,
              observedAt,
              fieldPaths: [
                "pricing.kind",
                "pricing.input_usd_per_1m_tokens",
                "pricing.output_usd_per_1m_tokens",
                "pricing.currency"
              ],
              confidence: "high",
              rawReference: {
                snapshot_id: "qwencloud-pricing-doc-live-response",
                provider_model_id: modelId,
                tier_basis: rate?.tierBasis ?? null
              }
            })
          ]
        : [])
    ],
    policy: {
      visibility: "listed",
      tags: [...(tag ? [tag] : []), ...(capabilities.includes("coding") ? ["coding"] : [])],
      recommended_for_agentic_workflows: null
    }
  };
}

function normalizeTokenPlanModel(entry: TokenPlanEntry, observedAt: string): ModelOffering {
  const modelClass = classifyModel(entry.modelId);
  const capabilities = capabilitiesFromDocText(entry.capabilityText, entry.modelId, modelClass);
  const protocol = protocolForClass(modelClass);
  const tag = classTag(modelClass);
  const sourceUrls: Record<TokenPlanEdition, string> = {
    personal: TOKEN_PLAN_PERSONAL_DOC_URL,
    team: TOKEN_PLAN_TEAM_DOC_URL
  };

  return {
    id: `qwencloud-token-plan:${entry.modelId}`,
    object: "model_offering",
    display_name: displayNameFor(entry.modelId, entry.brand),
    provider: {
      id: qwencloudTokenPlanProvider.id,
      name: qwencloudTokenPlanProvider.name
    },
    provider_model_id: entry.modelId,
    canonical_model: {
      id: entry.modelId,
      confidence: "medium",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description: null,
    endpoint: {
      protocol,
      base_url: protocol === "openai_chat_completions" ? TOKEN_PLAN_BASE_URL : null,
      model: entry.modelId
    },
    capabilities,
    limits: {
      context_tokens: null,
      max_output_tokens: null
    },
    pricing: {
      // Token Plan is a flat monthly subscription metered in Credits, not tokens. No public per-model
      // Credits coefficient exists, so the per-token fields stay null rather than carry a false rate
      // (ADR 0007 departs from ADR 0006's reference-pricing shape for exactly this reason).
      kind: "subscription_included",
      input_usd_per_1m_tokens: null,
      output_usd_per_1m_tokens: null,
      currency: null,
      metering: "credits",
      free: null,
      subscription: {
        billing: "flat_monthly",
        per_token_billed: false,
        reference_pricing: false,
        credits_metered: true,
        plan_editions: entry.editions,
        pricing_url: qwencloudTokenPlanProvider.homepage,
        interactive_use_only: true
      }
    },
    availability: {
      status: "available",
      last_checked_at: observedAt,
      last_success_at: observedAt,
      stale_after_seconds: STALE_AFTER_SECONDS
    },
    quality: {
      coding_score: null,
      reasoning_score: null,
      agentic_score: null,
      speed_score: null,
      benchmarks: null,
      recommendation_notes: entry.capabilityText ? [entry.capabilityText] : []
    },
    source_claims: entry.editions.map((edition) =>
      claim({
        id: `qwencloud-token-plan:${entry.modelId}:roster:${edition}`,
        collector: "qwencloud-token-plan",
        sourceType: "provider_docs",
        sourceUrl: sourceUrls[edition],
        observedAt,
        fieldPaths: [
          "provider_model_id",
          "endpoint.model",
          "capabilities",
          "pricing.kind",
          "pricing.subscription.plan_editions"
        ],
        confidence: "high",
        rawReference: {
          snapshot_id: `qwencloud-token-plan-${edition}-doc-live-response`,
          provider_model_id: entry.modelId,
          plan_edition: edition,
          brand: entry.brand
        }
      })
    ),
    policy: {
      visibility: "listed",
      tags: [
        "token-plan",
        ...entry.editions.map((edition) => `token-plan-${edition}`),
        ...(tag ? [tag] : []),
        ...(capabilities.includes("coding") ? ["coding"] : [])
      ],
      recommended_for_agentic_workflows: capabilities.includes("chat") ? true : null
    }
  };
}

export const qwencloudCollector: Collector = {
  id: "qwencloud",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const observedAt = nowIso(context);
    const [mapping, pricingDoc] = await Promise.all([
      fetchJson<ModelMappingResponse>(context, MODEL_MAPPING_URL),
      fetchText(context, PRICING_DOC_URL)
    ]);

    if (!mapping.ok) {
      return {
        provider: qwencloudProvider,
        models: [],
        notices: [
          collectorNotice("qwencloud", "collector unavailable", {
            status: mapping.status,
            error: mapping.error
          })
        ]
      };
    }

    const notices: CollectorNotice[] = pricingDoc.ok
      ? []
      : [
          collectorNotice("qwencloud", "pricing document unavailable; rates left unknown", {
            status: pricingDoc.status,
            error: pricingDoc.error
          })
        ];

    const rates = pricingDoc.ok ? parseTokenRates(pricingDoc.text) : new Map<string, TokenRate>();
    const entries =
      mapping.data && typeof mapping.data === "object" && !Array.isArray(mapping.data)
        ? Object.entries(mapping.data)
        : [];

    const models = entries
      .map(([modelId, internalId]) => {
        const id = normalizeText(modelId);
        return id === null ? null : normalizeMarketplaceModel(id, normalizeText(internalId), rates.get(id), observedAt);
      })
      .filter((model): model is ModelOffering => model !== null);

    if (models.length === 0) {
      notices.push(
        collectorNotice("qwencloud", "model mapping response carried no models", { status: mapping.status })
      );
    }

    return {
      provider: qwencloudProvider,
      models,
      notices
    };
  }
};

export const qwencloudTokenPlanCollector: Collector = {
  id: "qwencloud-token-plan",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const observedAt = nowIso(context);
    const [personal, team] = await Promise.all([
      fetchText(context, TOKEN_PLAN_PERSONAL_DOC_URL),
      fetchText(context, TOKEN_PLAN_TEAM_DOC_URL)
    ]);

    if (!personal.ok && !team.ok) {
      return {
        provider: qwencloudTokenPlanProvider,
        models: [],
        notices: [
          collectorNotice("qwencloud-token-plan", "collector unavailable", {
            status: personal.status,
            error: personal.error
          })
        ]
      };
    }

    const notices: CollectorNotice[] = [];
    const byModelId = new Map<string, TokenPlanEntry>();

    const editions: Array<{ edition: TokenPlanEdition; markdown: string | null; status: number; error: string | null }> = [
      {
        edition: "personal",
        markdown: personal.ok ? personal.text : null,
        status: personal.status,
        error: personal.ok ? null : personal.error
      },
      {
        edition: "team",
        markdown: team.ok ? team.text : null,
        status: team.status,
        error: team.ok ? null : team.error
      }
    ];

    for (const source of editions) {
      if (source.markdown === null) {
        notices.push(
          collectorNotice("qwencloud-token-plan", `${source.edition} roster unavailable`, {
            status: source.status,
            error: source.error
          })
        );
        continue;
      }

      const roster = parseTokenPlanRoster(source.markdown);
      if (roster.length === 0) {
        notices.push(
          collectorNotice("qwencloud-token-plan", `${source.edition} roster table not found in document`, {
            source_url: source.edition === "personal" ? TOKEN_PLAN_PERSONAL_DOC_URL : TOKEN_PLAN_TEAM_DOC_URL
          })
        );
        continue;
      }

      for (const item of roster) {
        const existing = byModelId.get(item.modelId);
        if (existing) {
          existing.editions.push(source.edition);
          existing.brand = existing.brand ?? item.brand;
          existing.capabilityText = existing.capabilityText ?? item.capabilityText;
          continue;
        }

        byModelId.set(item.modelId, {
          modelId: item.modelId,
          brand: item.brand,
          capabilityText: item.capabilityText,
          editions: [source.edition]
        });
      }
    }

    const models = [...byModelId.values()].map((entry) => normalizeTokenPlanModel(entry, observedAt));

    return {
      provider: qwencloudTokenPlanProvider,
      models,
      notices
    };
  }
};
