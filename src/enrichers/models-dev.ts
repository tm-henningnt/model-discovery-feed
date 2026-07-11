import { z } from "zod";
import type { Capability, ModelOffering } from "../feed/schema";
import { claim, collectorNotice, fetchJson, normalizeText, toNonNegativeNumber, toPositiveInt } from "../collectors/shared";
import type { CollectorContext, CollectorNotice } from "../collectors/types";

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODELS_DEV_SOURCE_URL = "https://models.dev/";
export const MODELS_DEV_COLLECTOR_ID = "models-dev";

const modelsDevModelSchema = z
  .object({
    id: z.unknown().optional(),
    attachment: z.unknown().optional(),
    reasoning: z.unknown().optional(),
    tool_call: z.unknown().optional(),
    knowledge: z.unknown().optional(),
    release_date: z.unknown().optional(),
    open_weights: z.unknown().optional(),
    limit: z
      .object({
        context: z.unknown().optional(),
        output: z.unknown().optional()
      })
      .passthrough()
      .optional(),
    cost: z
      .object({
        input: z.unknown().optional(),
        output: z.unknown().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const modelsDevProviderSchema = z
  .object({
    models: z.record(modelsDevModelSchema).optional()
  })
  .passthrough();

const modelsDevResponseSchema = z.record(modelsDevProviderSchema);

export type ModelsDevResponse = z.infer<typeof modelsDevResponseSchema>;

export type ModelsDevEnrichmentResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
};

const modelsDevProviderByProviderId: Record<string, string> = {
  gemini: "google",
  groq: "groq",
  "github-models": "github-models",
  openrouter: "openrouter"
};

/*
 * Gemini's ListModels response does not expose a capability array, so absence
 * of tool/reasoning/vision there is a genuine gap. Groq's supported_features
 * and modalities, GitHub Models' capabilities and modalities, and
 * OpenRouter's supported_parameters, modalities, and reasoning fields do
 * explicitly enumerate these dimensions; their absence is authoritative.
 */
const capabilityGapFillAllowed: Record<string, boolean> = {
  gemini: true,
  groq: false,
  "github-models": false,
  openrouter: false
};

type ModelsDevModel = z.infer<typeof modelsDevModelSchema>;

function responseBody(value: unknown): ModelsDevResponse | null {
  const result = modelsDevResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

function modelsDevDate(value: unknown): string | null {
  const date = normalizeText(value);
  if (!date) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  // models.dev knowledge cutoffs are commonly month-precision (for example,
  // "2024-06"); the feed contract stores calendar dates, without claiming
  // precision beyond the source's month.
  if (/^\d{4}-\d{2}$/.test(date)) {
    return `${date}-01`;
  }

  return null;
}

function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pricingDiffersMoreThanTwentyPercent(providerValue: number, modelsDevValue: number): boolean {
  if (providerValue === 0) {
    return modelsDevValue !== 0;
  }

  return Math.abs(modelsDevValue - providerValue) / providerValue > 0.2;
}

function enrichOffering(model: ModelOffering, source: ModelsDevModel, modelsDevProviderId: string, context: CollectorContext): {
  model: ModelOffering;
  notice: CollectorNotice | null;
} {
  const fieldPaths: string[] = [];
  const capabilities = [...model.capabilities];
  const canFillCapabilities = capabilityGapFillAllowed[model.provider.id] === true;
  const capabilityFields: Array<{ sourceField: "tool_call" | "reasoning" | "attachment"; capability: Capability }> = [
    { sourceField: "tool_call", capability: "tool_use" },
    { sourceField: "reasoning", capability: "reasoning" },
    { sourceField: "attachment", capability: "vision" }
  ];

  for (const { sourceField, capability } of capabilityFields) {
    if (canFillCapabilities && source[sourceField] === true && !capabilities.includes(capability)) {
      capabilities.push(capability);
    }
  }
  if (capabilities.length !== model.capabilities.length) {
    fieldPaths.push("capabilities");
  }

  const contextTokens = model.limits.context_tokens === null ? toPositiveInt(source.limit?.context) : null;
  const maxOutputTokens = model.limits.max_output_tokens === null ? toPositiveInt(source.limit?.output) : null;
  if (contextTokens !== null) {
    fieldPaths.push("limits.context_tokens");
  }
  if (maxOutputTokens !== null) {
    fieldPaths.push("limits.max_output_tokens");
  }

  let canonicalModel = model.canonical_model;
  if (canonicalModel) {
    const knowledgeCutoff = modelsDevDate(source.knowledge);
    const releaseDate = modelsDevDate(source.release_date);
    const openWeights = typeof source.open_weights === "boolean" ? source.open_weights : null;

    if (knowledgeCutoff !== null && canonicalModel.knowledge_cutoff === null) {
      canonicalModel = { ...canonicalModel, knowledge_cutoff: knowledgeCutoff };
      fieldPaths.push("canonical_model.knowledge_cutoff");
    }
    if (releaseDate !== null && canonicalModel.release_date === null) {
      canonicalModel = { ...canonicalModel, release_date: releaseDate };
      fieldPaths.push("canonical_model.release_date");
    }
    if (openWeights !== null && canonicalModel.open_weights === null) {
      canonicalModel = { ...canonicalModel, open_weights: openWeights };
      fieldPaths.push("canonical_model.open_weights");
    }
  }

  const sourceReference = {
    snapshot_id: "models-dev-live-response",
    json_pointer: `/${escapeJsonPointerSegment(modelsDevProviderId)}/models/${escapeJsonPointerSegment(model.provider_model_id)}`,
    provider_model_id: model.provider_model_id
  };
  const enriched = fieldPaths.length === 0
    ? model
    : {
        ...model,
        capabilities,
        limits: {
          ...model.limits,
          context_tokens: contextTokens ?? model.limits.context_tokens,
          max_output_tokens: maxOutputTokens ?? model.limits.max_output_tokens
        },
        canonical_model: canonicalModel,
        source_claims: [
          ...model.source_claims,
          claim({
            id: `${MODELS_DEV_COLLECTOR_ID}:${model.id}`,
            collector: MODELS_DEV_COLLECTOR_ID,
            sourceType: "third_party_catalog",
            sourceUrl: MODELS_DEV_SOURCE_URL,
            observedAt: context.now.toISOString(),
            fieldPaths,
            confidence: "medium",
            rawReference: sourceReference
          })
        ]
      };

  const providerInput = model.pricing.input_usd_per_1m_tokens;
  const providerOutput = model.pricing.output_usd_per_1m_tokens;
  const modelsDevInput = toNonNegativeNumber(source.cost?.input);
  const modelsDevOutput = toNonNegativeNumber(source.cost?.output);
  const inputMismatch = providerInput !== null && modelsDevInput !== null && pricingDiffersMoreThanTwentyPercent(providerInput, modelsDevInput);
  const outputMismatch = providerOutput !== null && modelsDevOutput !== null && pricingDiffersMoreThanTwentyPercent(providerOutput, modelsDevOutput);

  return {
    model: enriched,
    notice: inputMismatch || outputMismatch
      ? collectorNotice(MODELS_DEV_COLLECTOR_ID, "models-dev pricing mismatch", {
          offering_id: model.id,
          input: providerInput !== null && modelsDevInput !== null ? { provider: providerInput, models_dev: modelsDevInput } : null,
          output: providerOutput !== null && modelsDevOutput !== null ? { provider: providerOutput, models_dev: modelsDevOutput } : null
        })
      : null
  };
}

/**
 * Gap-fills provider collection with models.dev catalog metadata after
 * canonicalization. It deliberately has no carry-forward: unlike headline AA
 * scores, unavailable metadata should leave the current first-party result
 * unchanged and surface a notice for this run.
 */
export async function enrichWithModelsDev(options: {
  models: ModelOffering[];
  context: CollectorContext;
}): Promise<ModelsDevEnrichmentResult> {
  const response = await fetchJson<unknown>(options.context, MODELS_DEV_API_URL);
  if (!response.ok) {
    return {
      models: options.models,
      notices: [
        collectorNotice(MODELS_DEV_COLLECTOR_ID, "models.dev unavailable", {
          status: response.status,
          error: response.error
        })
      ]
    };
  }

  const body = responseBody(response.data);
  if (!body) {
    return {
      models: options.models,
      notices: [
        collectorNotice(MODELS_DEV_COLLECTOR_ID, "models.dev response invalid", { status: response.status })
      ]
    };
  }

  const notices: CollectorNotice[] = [];
  const models = options.models.map((model) => {
    const modelsDevProviderId = modelsDevProviderByProviderId[model.provider.id];
    const source = modelsDevProviderId ? body[modelsDevProviderId]?.models?.[model.provider_model_id] : undefined;
    if (!source || !modelsDevProviderId) {
      return model;
    }

    const enriched = enrichOffering(model, source, modelsDevProviderId, options.context);
    if (enriched.notice) {
      notices.push(enriched.notice);
    }
    return enriched.model;
  });

  return { models, notices };
}
