import { z } from "zod";

export const capabilitySchema = z.enum([
  "chat",
  "coding",
  "reasoning",
  "tool_use",
  "structured_output",
  "json_mode",
  "streaming",
  "vision",
  "image_generation",
  "embeddings",
  "reranking",
  "speech_to_text",
  "text_to_speech",
  "batch",
  "prompt_caching",
  "files"
]);

export const endpointProtocolSchema = z.enum([
  "openai_chat_completions",
  "openai_responses",
  "anthropic_messages",
  "gemini_generate_content",
  "github_models",
  "huggingface_inference",
  "local_openai_compatible",
  "unknown"
]);

export const pricingKindSchema = z.enum([
  "free",
  "free_tier",
  "trial",
  "subscription_included",
  "paid",
  "local",
  "unknown"
]);

export const freeBasisSchema = z.enum([
  "zero_priced_model",
  "account_free_tier",
  "trial_credit",
  "temporary_promotion",
  "local_runtime",
  "manual_override",
  "unknown"
]);

export const availabilityStatusSchema = z.enum([
  "available",
  "limited",
  "degraded",
  "deprecated",
  "retired",
  "blocked",
  "unknown"
]);

export const confidenceSchema = z.enum(["high", "medium", "low"]);

export const sourceTypeSchema = z.enum([
  "provider_api",
  "provider_docs",
  "pricing_page",
  "catalog_page",
  "health_check",
  "manual_override",
  "local_runtime",
  "third_party_catalog"
]);

export const sourceClaimSchema = z
  .object({
    id: z.string().min(1),
    source_type: sourceTypeSchema,
    source_url: z.string().url().nullable(),
    collector: z.string().min(1),
    observed_at: z.string().datetime(),
    field_paths: z.array(z.string().min(1)).min(1),
    confidence: confidenceSchema,
    raw_reference: z.record(z.unknown()).nullable()
  })
  .passthrough();

export const providerSchema = z
  .object({
    id: z.string().min(1),
    object: z.literal("provider"),
    name: z.string().min(1),
    homepage: z.string().url().nullable(),
    api_protocols: z.array(endpointProtocolSchema),
    default_base_url: z.string().url().nullable(),
    authentication: z
      .object({
        type: z.enum(["api_key", "none", "oauth", "unknown"]),
        header: z.string().nullable(),
        scheme: z.string().nullable(),
        credential_hint: z.string().nullable()
      })
      .passthrough(),
    signup: z
      .object({
        required: z.boolean().nullable(),
        credit_card_required: z.boolean().nullable()
      })
      .passthrough(),
    source_claims: z.array(sourceClaimSchema)
  })
  .passthrough();

export const modelOfferingSchema = z
  .object({
    id: z.string().min(1),
    object: z.literal("model_offering"),
    display_name: z.string().min(1),
    provider: z.object({
      id: z.string().min(1),
      name: z.string().min(1)
    }),
    provider_model_id: z.string().min(1),
    canonical_model: z
      .object({
        id: z.string().min(1),
        confidence: confidenceSchema,
        knowledge_cutoff: z.string().date().nullable(),
        release_date: z.string().date().nullable(),
        open_weights: z.boolean().nullable()
      })
      .nullable(),
    description: z.string().nullable(),
    endpoint: z
      .object({
        protocol: endpointProtocolSchema,
        base_url: z.string().url().nullable(),
        model: z.string().min(1),
        protocol_options: z
          .object({
            response_envelope_key: z.string().nullable().optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough(),
    capabilities: z.array(capabilitySchema),
    limits: z
      .object({
        context_tokens: z.number().int().positive().nullable(),
        max_output_tokens: z.number().int().positive().nullable()
      })
      .passthrough(),
    pricing: z
      .object({
        kind: pricingKindSchema,
        input_usd_per_1m_tokens: z.number().nonnegative().nullable(),
        output_usd_per_1m_tokens: z.number().nonnegative().nullable(),
        currency: z.string().nullable(),
        metering: z.string().nullable(),
        free: z
          .object({
            is_currently_free: z.boolean(),
            basis: freeBasisSchema,
            requires_account: z.boolean().nullable(),
            requires_api_key: z.boolean().nullable(),
            requires_credit_card: z.boolean().nullable(),
            quota: z.string().nullable(),
            expires_at: z.string().datetime().nullable(),
            last_verified_at: z.string().datetime(),
            confidence: confidenceSchema
          })
          .passthrough()
          .nullable(),
        // A subscription's facts vary per provider, so the object stays open. `plan_editions` is
        // named because it is the only key a consumer must read to route correctly: a plan with
        // several editions sells a different roster per edition (ADR 0012).
        subscription: z
          .object({
            plan_editions: z.array(z.string()).optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough(),
    availability: z
      .object({
        status: availabilityStatusSchema,
        last_checked_at: z.string().datetime().nullable(),
        last_success_at: z.string().datetime().nullable(),
        stale_after_seconds: z.number().int().positive().nullable()
      })
      .passthrough(),
    quality: z
      .object({
        coding_score: z
          .number()
          .nullable()
          .describe("Artificial Analysis coding index, 0–100, stored verbatim."),
        reasoning_score: z
          .number()
          .nullable()
          .describe("Artificial Analysis intelligence index, 0–100, stored verbatim."),
        agentic_score: z
          .number()
          .nullable()
          .describe("Artificial Analysis agentic index, 0–100, stored verbatim."),
        speed_score: z
          .number()
          .nullable()
          .describe("Artificial Analysis median output speed in tokens/sec, stored verbatim."),
        benchmarks: z
          .object({
            math_score: z
              .number()
              .nullable()
              .optional()
              .describe("Artificial Analysis math index, 0–100, stored verbatim."),
            ttft_seconds: z
              .number()
              .nonnegative()
              .nullable()
              .optional()
              .describe("Artificial Analysis median time to first token in seconds, stored verbatim."),
            artificial_analysis: z
              .record(z.number())
              .nullable()
              .optional()
              .describe("Artificial Analysis sub-benchmark scores, stored verbatim."),
            design_arena: z
              .array(
                z
                  .object({
                    arena: z.string().nullable().optional(),
                    category: z.string().nullable().optional(),
                    elo: z.number().nullable().optional(),
                    rank: z.number().nullable().optional(),
                    win_rate: z.number().nullable().optional()
                  })
                  .passthrough()
              )
              .nullable()
              .optional()
              .describe("Design Arena ratings, stored verbatim.")
          })
          .passthrough()
          .nullable(),
        recommendation_notes: z.array(z.string())
      })
      .passthrough(),
    source_claims: z
      .array(sourceClaimSchema)
      .min(1, { message: "model offerings must include at least one source claim" }),
    policy: z
      .object({
        visibility: z.enum(["listed", "hidden", "blocked"]),
        tags: z.array(z.string()),
        recommended_for_agentic_workflows: z.boolean().nullable()
      })
      .passthrough()
  })
  .passthrough()
  .superRefine((offering, ctx) => {
    if (offering.pricing.kind === "free" && offering.pricing.free === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pricing", "free"],
        message: "pricing.kind=free offerings must include pricing.free metadata"
      });
    }
  });

export const profileSchema = z
  .object({
    id: z.string().min(1),
    object: z.literal("profile"),
    display_name: z.string().min(1),
    description: z.string().nullable(),
    selection: z.object({
      model_offering_id: z.string().min(1),
      selected_at: z.string().datetime(),
      expires_at: z.string().datetime().nullable()
    }),
    criteria: z.record(z.unknown())
  })
  .passthrough();

export const feedDocumentSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    feed: z
      .object({
        id: z.string().min(1),
        generated_at: z.string().datetime(),
        expires_at: z.string().datetime().nullable(),
        source_revision: z.string().min(1),
        default_stale_after_seconds: z.number().int().positive()
      })
      .passthrough(),
    providers: z.array(providerSchema),
    models: z.array(modelOfferingSchema),
    profiles: z.array(profileSchema),
    notices: z.array(z.record(z.unknown())),
    attributions: z
      .array(
        z
          .object({
            source: z.string().min(1),
            url: z.string().url(),
            notice: z.string().min(1)
          })
          .passthrough()
      )
      .default([])
  })
  .passthrough()
  .superRefine((feed, ctx) => {
    const providerIds = new Set<string>();
    feed.providers.forEach((provider, index) => {
      if (providerIds.has(provider.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["providers", index, "id"],
          message: `duplicate provider id: ${provider.id}`
        });
        return;
      }

      providerIds.add(provider.id);
    });

    const modelIds = new Set<string>();
    const providerIdSet = providerIds;
    feed.models.forEach((model, index) => {
      if (modelIds.has(model.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["models", index, "id"],
          message: `duplicate model id: ${model.id}`
        });
      } else {
        modelIds.add(model.id);
      }

      if (!providerIdSet.has(model.provider.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["models", index, "provider", "id"],
          message: `unknown provider id: ${model.provider.id}`
        });
      }
    });

    const modelIdSet = modelIds;
    feed.profiles.forEach((profile, index) => {
      if (!modelIdSet.has(profile.selection.model_offering_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profiles", index, "selection", "model_offering_id"],
          message: `unknown model id: ${profile.selection.model_offering_id}`
        });
      }
    });
  });

export type Capability = z.infer<typeof capabilitySchema>;
export type EndpointProtocol = z.infer<typeof endpointProtocolSchema>;
export type PricingKind = z.infer<typeof pricingKindSchema>;
export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;
export type SourceClaim = z.infer<typeof sourceClaimSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type ModelOffering = z.infer<typeof modelOfferingSchema>;
export type FeedProfile = z.infer<typeof profileSchema>;
export type FeedDocument = z.infer<typeof feedDocumentSchema>;

export function validateFeedDocument(input: unknown): FeedDocument {
  return feedDocumentSchema.parse(input);
}
