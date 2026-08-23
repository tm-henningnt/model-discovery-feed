import type { Capability, EndpointProtocol, ModelOffering, Provider } from "../feed/schema";
import type { Collector, CollectorContext, CollectorResult } from "./types";
import {
  claim,
  cleanCapabilityList,
  collectorNotice,
  fetchJson,
  normalizeText,
  nowIso,
  toNonNegativeNumber,
  toPositiveInt
} from "./shared";

const BASE_URL = "https://api.venice.ai/api/v1";
const CATALOG_URL = `${BASE_URL}/models?type=all`;
const STALE_AFTER_SECONDS = 86400;

/** The nine model types Venice's `type` enum publishes. */
type VeniceModelType =
  | "asr"
  | "embedding"
  | "image"
  | "inpaint"
  | "music"
  | "text"
  | "tts"
  | "upscale"
  | "video";

type VenicePrice = {
  usd?: number | null;
  diem?: number | null;
};

type VeniceCapabilities = {
  optimizedForCode?: boolean | null;
  quantization?: string | null;
  supportsAudioInput?: boolean | null;
  supportsE2EE?: boolean | null;
  supportsFunctionCalling?: boolean | null;
  supportsLogProbs?: boolean | null;
  supportsReasoning?: boolean | null;
  supportsResponseSchema?: boolean | null;
  supportsTeeAttestation?: boolean | null;
  supportsVideoInput?: boolean | null;
  supportsVision?: boolean | null;
  supportsWebSearch?: boolean | null;
  [key: string]: unknown;
};

type VeniceModelSpec = {
  availableContextTokens?: number | null;
  betaModel?: boolean | null;
  capabilities?: VeniceCapabilities | null;
  deprecation?: {
    autoRemap?: boolean | null;
    date?: string | null;
    removesAt?: string | null;
    replacementModelId?: string | null;
    startsAt?: string | null;
  } | null;
  description?: string | null;
  embeddingDimensions?: number | null;
  maxCompletionTokens?: number | null;
  maxInputTokens?: number | null;
  modelSource?: string | null;
  name?: string | null;
  offline?: boolean | null;
  pricing?: Record<string, unknown> | null;
  privacy?: string | null;
  traits?: string[] | null;
  uncensored?: boolean | null;
  [key: string]: unknown;
};

type VeniceModel = {
  context_length?: number | null;
  created?: number | null;
  id: string;
  model_spec?: VeniceModelSpec | null;
  object?: string | null;
  owned_by?: string | null;
  type?: string | null;
};

type VeniceResponse = {
  data?: VeniceModel[];
};

const provider: Provider = {
  id: "venice",
  object: "provider",
  name: "Venice",
  homepage: "https://venice.ai",
  api_protocols: ["openai_chat_completions"],
  default_base_url: BASE_URL,
  authentication: {
    type: "api_key",
    header: "Authorization",
    scheme: "Bearer",
    credential_hint: "VENICE_AI_API_KEY"
  },
  signup: {
    required: true,
    credit_card_required: null
  },
  source_claims: []
};

/**
 * Venice sells nine model types through one catalog and bills each on its own meter, so the type
 * drives capabilities, metering, endpoint protocol, and the policy tag.
 */
const MODEL_TYPES = new Set<string>([
  "asr",
  "embedding",
  "image",
  "inpaint",
  "music",
  "text",
  "tts",
  "upscale",
  "video"
]);

function modelType(value: unknown): VeniceModelType | null {
  const text = normalizeText(value);
  return text !== null && MODEL_TYPES.has(text) ? (text as VeniceModelType) : null;
}

/**
 * `openai_chat_completions` names one exact protocol. Venice serves embeddings, speech, images,
 * music, and video through other request shapes, so their protocol is `unknown` rather than a
 * chat-completions claim that would not work. This is the rule ADR 0007 applied to QwenCloud.
 */
function protocolForType(type: VeniceModelType): EndpointProtocol {
  return type === "text" ? "openai_chat_completions" : "unknown";
}

/** The unit Venice bills the type in. Only `tokens` fits the contract's per-1M-token rate fields. */
function meteringForType(type: VeniceModelType, pricing: Record<string, unknown>): string {
  switch (type) {
    case "text":
    case "embedding":
      return "tokens";
    case "tts":
      return "characters";
    case "asr":
      return "audio_seconds";
    case "image":
    case "inpaint":
    case "upscale":
      return "images";
    case "video":
      return "video_seconds";
    case "music":
      // Venice bills music per second, per thousand characters, or per generation, one key per model.
      if ("per_second" in pricing) return "audio_seconds";
      if ("per_thousand_characters" in pricing) return "characters";
      return "generations";
    default:
      return "unknown";
  }
}

function tagForType(type: VeniceModelType): string | null {
  switch (type) {
    case "embedding":
      return "embeddings";
    case "tts":
      return "text-to-speech";
    case "asr":
      return "speech-to-text";
    case "image":
      return "image-generation";
    case "inpaint":
      return "image-editing";
    case "upscale":
      return "image-upscaling";
    case "music":
      return "music-generation";
    case "video":
      return "video-generation";
    default:
      return null;
  }
}

function capabilitiesFor(type: VeniceModelType, flags: VeniceCapabilities): Capability[] {
  if (type === "embedding") return cleanCapabilityList(["embeddings"]);
  if (type === "tts") return cleanCapabilityList(["text_to_speech"]);
  if (type === "asr") return cleanCapabilityList(["speech_to_text"]);
  if (type === "image" || type === "inpaint" || type === "upscale") {
    return cleanCapabilityList(["image_generation"]);
  }
  // The capability enum has no music or video term, so those models carry a policy tag instead.
  if (type === "music" || type === "video") return [];

  const candidates = new Set<string>(["chat", "streaming"]);
  if (flags.optimizedForCode === true) candidates.add("coding");
  if (flags.supportsFunctionCalling === true) candidates.add("tool_use");
  if (flags.supportsResponseSchema === true) candidates.add("structured_output");
  if (flags.supportsReasoning === true) candidates.add("reasoning");
  if (flags.supportsVision === true || flags.supportsVideoInput === true) candidates.add("vision");
  // A chat model that accepts audio transcribes it, the same reading ADR 0007 gave QwenCloud's
  // omni class. It is not a claim that the model emits audio.
  if (flags.supportsAudioInput === true) candidates.add("speech_to_text");
  return cleanCapabilityList(candidates);
}

/**
 * A per-million-token rate Venice publishes, in USD.
 *
 * `shared.tokenPricing` is not reused here: it expects a per-token rate and multiplies by a
 * million. Venice's `pricing.input.usd` is already USD per million tokens.
 */
function usdPerMillion(price: unknown): number | null {
  const record = price as VenicePrice | null | undefined;
  return record ? toNonNegativeNumber(record.usd) : null;
}

type VenicePricing = {
  pricing: ModelOffering["pricing"];
  /** The unit price and unit for a meter the contract's token fields cannot carry. */
  unitPrice: { usd: number; unit: string } | null;
};

/**
 * The single USD figure a non-token meter publishes, when the model has one. Venice publishes a
 * price matrix for several image and video models (per resolution, per quality, per duration
 * band); no one figure describes those, so they report none.
 */
function unitPriceUsd(pricing: Record<string, unknown>): number | null {
  for (const key of ["generation", "inpaint", "per_audio_second", "per_second", "per_thousand_characters"]) {
    if (key in pricing) {
      const usd = usdPerMillion(pricing[key]);
      if (usd !== null) return usd;
    }
  }
  return null;
}

function derivePricing(
  type: VeniceModelType,
  pricing: Record<string, unknown>,
  observedAt: string
): VenicePricing {
  const metering = meteringForType(type, pricing);

  if (metering !== "tokens") {
    const usd = unitPriceUsd(pricing);
    return {
      // An offering billed per image, per second, or per character is known to be paid, but the
      // contract carries only per-1M-token rate fields. State `paid` with null rates and let
      // `metering` say which unit applies, as ADR 0007 does for QwenCloud.
      pricing: {
        kind: "paid",
        input_usd_per_1m_tokens: null,
        output_usd_per_1m_tokens: null,
        currency: "USD",
        metering,
        free: null
      },
      unitPrice: usd === null ? null : { usd, unit: metering }
    };
  }

  const inputRate = usdPerMillion(pricing.input);
  const outputRate = usdPerMillion(pricing.output);
  const bothZero = inputRate === 0 && outputRate === 0;
  const kind = bothZero ? "free" : inputRate === null || outputRate === null ? "unknown" : "paid";

  return {
    pricing: {
      kind,
      input_usd_per_1m_tokens: inputRate,
      output_usd_per_1m_tokens: outputRate,
      currency: inputRate !== null || outputRate !== null ? "USD" : null,
      metering: "tokens",
      free: bothZero
        ? {
            is_currently_free: true,
            basis: "zero_priced_model",
            requires_account: true,
            requires_api_key: true,
            requires_credit_card: null,
            quota: null,
            expires_at: null,
            last_verified_at: observedAt,
            // Venice sets its own price schedule rather than republishing an upstream catalog's
            // rates, so a rate of zero is Venice's own claim about its own bill (ADR 0013).
            confidence: "high"
          }
        : null
    },
    unitPrice: null
  };
}

/**
 * ADR 0008 status precedence rule (b): Venice publishes `removesAt`, the instant it drops the model
 * from this catalog. A date in the past gives `retired` and a date in the future gives `deprecated`.
 */
function availabilityStatus(
  spec: VeniceModelSpec,
  now: Date
): ModelOffering["availability"]["status"] {
  const removesAt = normalizeText(spec.deprecation?.removesAt ?? spec.deprecation?.date);
  if (removesAt === null) {
    return "available";
  }

  const parsed = Date.parse(removesAt);
  if (Number.isNaN(parsed)) {
    return "deprecated";
  }
  return parsed <= now.getTime() ? "retired" : "deprecated";
}

function limitsFor(model: VeniceModel, spec: VeniceModelSpec): ModelOffering["limits"] {
  return {
    context_tokens: toPositiveInt(spec.availableContextTokens ?? model.context_length ?? spec.maxInputTokens),
    max_output_tokens: toPositiveInt(spec.maxCompletionTokens)
  };
}

function policyTags(type: VeniceModelType, spec: VeniceModelSpec, flags: VeniceCapabilities): string[] {
  const tags = new Set<string>();
  const typeTag = tagForType(type);
  if (typeTag) tags.add(typeTag);
  if (flags.supportsReasoning === true) tags.add("reasoning");
  if (flags.supportsWebSearch === true) tags.add("web-search");
  // Venice's privacy tier is the reason a consumer picks it over a cheaper reseller: `private` means
  // zero data retention, and TEE and E2EE add hardware isolation and client-side encryption.
  const privacy = normalizeText(spec.privacy);
  if (privacy) tags.add(`privacy-${privacy}`);
  if (flags.supportsTeeAttestation === true) tags.add("privacy-tee");
  if (flags.supportsE2EE === true) tags.add("privacy-e2ee");
  if (spec.uncensored === true) tags.add("uncensored");
  if (spec.betaModel === true) tags.add("beta");
  // Serving precision is a property of Venice's deployment, not of the underlying model. It is a tag
  // so a consumer can tell a quantized deployment from a full-precision one.
  const quantization = normalizeText(flags.quantization);
  if (quantization && quantization !== "not-available") tags.add(`quantization-${quantization}`);
  return [...tags];
}

function normalizeVeniceModel(raw: VeniceModel, index: number, context: CollectorContext): ModelOffering | null {
  const providerModelId = normalizeText(raw.id);
  const type = modelType(raw.type);
  if (providerModelId === null || type === null) {
    return null;
  }

  const observedAt = nowIso(context);
  const spec = raw.model_spec ?? {};
  const flags = spec.capabilities ?? {};
  const pricingPayload = spec.pricing ?? {};
  const { pricing, unitPrice } = derivePricing(type, pricingPayload, observedAt);
  const protocol = protocolForType(type);
  const status = availabilityStatus(spec, context.now);
  const capabilities = capabilitiesFor(type, flags);

  return {
    id: `venice:${providerModelId}`,
    object: "model_offering",
    display_name: normalizeText(spec.name) ?? providerModelId,
    provider: {
      id: provider.id,
      name: provider.name
    },
    provider_model_id: providerModelId,
    canonical_model: {
      // Venice publishes its own id namespace, which flattens the dots in a model name
      // (`gemini-3-6-flash`). The curated alias table binds it to an OpenRouter slug (ADR 0003);
      // until then the id is a medium-confidence echo.
      id: providerModelId,
      confidence: "medium",
      knowledge_cutoff: null,
      release_date: null,
      open_weights: null
    },
    description: normalizeText(spec.description),
    endpoint: {
      protocol,
      base_url: protocol === "openai_chat_completions" ? BASE_URL : null,
      model: providerModelId
    },
    capabilities,
    limits: limitsFor(raw, spec),
    pricing,
    availability: {
      status,
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
        id: `venice:${providerModelId}:model:${index}`,
        collector: "venice",
        sourceUrl: CATALOG_URL,
        observedAt,
        fieldPaths: [
          "capabilities",
          "limits.context_tokens",
          "limits.max_output_tokens",
          "pricing.kind",
          "pricing.input_usd_per_1m_tokens",
          "pricing.output_usd_per_1m_tokens",
          "pricing.metering",
          "availability.status"
        ],
        confidence: "high",
        rawReference: {
          snapshot_id: "venice-live-response",
          json_pointer: `/data/${index}`,
          provider_model_id: providerModelId,
          model_type: type,
          privacy: normalizeText(spec.privacy),
          quantization: normalizeText(flags.quantization),
          model_source: normalizeText(spec.modelSource),
          removes_at: normalizeText(spec.deprecation?.removesAt ?? spec.deprecation?.date),
          replacement_model_id: normalizeText(spec.deprecation?.replacementModelId),
          // The contract has no field for a per-image or per-second rate, so the observed unit
          // price is recorded here rather than dropped.
          unit_price_usd: unitPrice?.usd ?? null,
          unit_price_unit: unitPrice?.unit ?? null
        }
      })
    ],
    policy: {
      visibility: "listed",
      tags: policyTags(type, spec, flags),
      recommended_for_agentic_workflows:
        capabilities.includes("tool_use") && capabilities.includes("structured_output") ? true : null
    }
  };
}

export const veniceCollector: Collector = {
  id: "venice",
  async collect(context: CollectorContext): Promise<CollectorResult> {
    const apiKey = normalizeText(context.env.VENICE_AI_API_KEY);
    const response = await fetchJson<VeniceResponse>(context, CATALOG_URL, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    });

    if (!response.ok) {
      return {
        provider,
        models: [],
        notices: [
          collectorNotice("venice", "collector unavailable", {
            status: response.status,
            error: response.error,
            has_api_key: Boolean(apiKey)
          })
        ]
      };
    }

    const payload = Array.isArray(response.data.data) ? response.data.data : [];
    const models = payload
      .map((raw, index) => normalizeVeniceModel(raw, index, context))
      .filter((model): model is ModelOffering => model !== null);

    const skipped = payload.length - models.length;
    return {
      provider,
      models,
      notices:
        skipped > 0
          ? [
              collectorNotice("venice", "skipped catalog entries with no id or an unknown type", {
                skipped_count: skipped,
                catalog_count: payload.length
              })
            ]
          : []
    };
  }
};
