export const feedJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://model-discovery-feed.local/v1/schema",
  title: "Model Discovery Feed v1",
  type: "object",
  required: ["schema_version", "feed", "providers", "models", "profiles", "notices"],
  additionalProperties: true,
  properties: {
    schema_version: { const: "1.0.0" },
    feed: { $ref: "#/$defs/feed" },
    providers: {
      type: "array",
      items: { $ref: "#/$defs/provider" }
    },
    models: {
      type: "array",
      items: { $ref: "#/$defs/model_offering" }
    },
    profiles: {
      type: "array",
      items: { $ref: "#/$defs/profile" }
    },
    notices: {
      type: "array",
      items: { $ref: "#/$defs/notice" }
    }
  },
  $defs: {
    capability: {
      enum: [
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
      ]
    },
    endpoint_protocol: {
      enum: [
        "openai_chat_completions",
        "openai_responses",
        "anthropic_messages",
        "gemini_generate_content",
        "github_models",
        "huggingface_inference",
        "local_openai_compatible",
        "unknown"
      ]
    },
    pricing_kind: {
      enum: ["free", "free_tier", "trial", "subscription_included", "paid", "local", "unknown"]
    },
    free_basis: {
      enum: [
        "zero_priced_model",
        "account_free_tier",
        "trial_credit",
        "temporary_promotion",
        "local_runtime",
        "manual_override",
        "unknown"
      ]
    },
    availability_status: {
      enum: ["available", "limited", "degraded", "deprecated", "retired", "blocked", "unknown"]
    },
    confidence: {
      enum: ["high", "medium", "low"]
    },
    source_type: {
      enum: [
        "provider_api",
        "provider_docs",
        "pricing_page",
        "catalog_page",
        "health_check",
        "manual_override",
        "local_runtime",
        "third_party_catalog"
      ]
    },
    visibility: {
      enum: ["listed", "hidden", "blocked"]
    },
    feed: {
      type: "object",
      required: ["id", "generated_at", "expires_at", "source_revision", "default_stale_after_seconds"],
      additionalProperties: true,
      properties: {
        id: { type: "string", minLength: 1 },
        generated_at: { type: "string", format: "date-time" },
        expires_at: { type: ["string", "null"], format: "date-time" },
        source_revision: { type: "string", minLength: 1 },
        default_stale_after_seconds: { type: "integer", minimum: 1 }
      }
    },
    provider_authentication: {
      type: "object",
      required: ["type", "header", "scheme", "credential_hint"],
      additionalProperties: true,
      properties: {
        type: {
          enum: ["api_key", "none", "oauth", "unknown"]
        },
        header: { type: ["string", "null"] },
        scheme: { type: ["string", "null"] },
        credential_hint: { type: ["string", "null"] }
      }
    },
    provider_signup: {
      type: "object",
      required: ["required", "credit_card_required"],
      additionalProperties: true,
      properties: {
        required: { type: ["boolean", "null"] },
        credit_card_required: { type: ["boolean", "null"] }
      }
    },
    source_claim: {
      type: "object",
      required: [
        "id",
        "source_type",
        "source_url",
        "collector",
        "observed_at",
        "field_paths",
        "confidence",
        "raw_reference"
      ],
      additionalProperties: true,
      properties: {
        id: { type: "string", minLength: 1 },
        source_type: { $ref: "#/$defs/source_type" },
        source_url: { type: ["string", "null"], format: "uri" },
        collector: { type: "string", minLength: 1 },
        observed_at: { type: "string", format: "date-time" },
        field_paths: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 }
        },
        confidence: { $ref: "#/$defs/confidence" },
        raw_reference: { type: ["object", "null"] }
      }
    },
    provider: {
      type: "object",
      required: [
        "id",
        "object",
        "name",
        "homepage",
        "api_protocols",
        "default_base_url",
        "authentication",
        "signup",
        "source_claims"
      ],
      additionalProperties: true,
      properties: {
        id: { type: "string", minLength: 1 },
        object: { const: "provider" },
        name: { type: "string", minLength: 1 },
        homepage: { type: ["string", "null"], format: "uri" },
        api_protocols: {
          type: "array",
          items: { $ref: "#/$defs/endpoint_protocol" }
        },
        default_base_url: { type: ["string", "null"], format: "uri" },
        authentication: { $ref: "#/$defs/provider_authentication" },
        signup: { $ref: "#/$defs/provider_signup" },
        source_claims: {
          type: "array",
          items: { $ref: "#/$defs/source_claim" }
        }
      }
    },
    canonical_model: {
      type: "object",
      required: ["id", "confidence"],
      additionalProperties: true,
      properties: {
        id: { type: "string", minLength: 1 },
        confidence: { $ref: "#/$defs/confidence" }
      }
    },
    endpoint: {
      type: "object",
      required: ["protocol", "base_url", "model"],
      additionalProperties: true,
      properties: {
        protocol: { $ref: "#/$defs/endpoint_protocol" },
        base_url: { type: ["string", "null"], format: "uri" },
        model: { type: "string", minLength: 1 },
        protocol_options: { type: "object", additionalProperties: true }
      }
    },
    limits: {
      type: "object",
      required: ["context_tokens", "max_output_tokens"],
      additionalProperties: true,
      properties: {
        context_tokens: { type: ["integer", "null"], minimum: 1 },
        max_output_tokens: { type: ["integer", "null"], minimum: 1 }
      }
    },
    pricing_free: {
      type: "object",
      required: [
        "is_currently_free",
        "basis",
        "requires_account",
        "requires_api_key",
        "requires_credit_card",
        "quota",
        "expires_at",
        "last_verified_at",
        "confidence"
      ],
      additionalProperties: true,
      properties: {
        is_currently_free: { type: "boolean" },
        basis: { $ref: "#/$defs/free_basis" },
        requires_account: { type: ["boolean", "null"] },
        requires_api_key: { type: ["boolean", "null"] },
        requires_credit_card: { type: ["boolean", "null"] },
        quota: { type: ["string", "null"] },
        expires_at: { type: ["string", "null"], format: "date-time" },
        last_verified_at: { type: "string", format: "date-time" },
        confidence: { $ref: "#/$defs/confidence" }
      }
    },
    pricing: {
      type: "object",
      required: [
        "kind",
        "input_usd_per_1m_tokens",
        "output_usd_per_1m_tokens",
        "currency",
        "metering",
        "free"
      ],
      additionalProperties: true,
      properties: {
        kind: { $ref: "#/$defs/pricing_kind" },
        input_usd_per_1m_tokens: { type: ["number", "null"], minimum: 0 },
        output_usd_per_1m_tokens: { type: ["number", "null"], minimum: 0 },
        currency: { type: ["string", "null"] },
        metering: { type: ["string", "null"] },
        free: {
          anyOf: [
            { type: "null" },
            { $ref: "#/$defs/pricing_free" }
          ]
        },
        subscription: { type: "object", additionalProperties: true }
      },
      allOf: [
        {
          if: {
            properties: {
              kind: { const: "free" }
            },
            required: ["kind"]
          },
          then: {
            required: ["free"],
            properties: {
              free: { $ref: "#/$defs/pricing_free" }
            }
          }
        }
      ]
    },
    availability: {
      type: "object",
      required: ["status", "last_checked_at", "last_success_at", "stale_after_seconds"],
      additionalProperties: true,
      properties: {
        status: { $ref: "#/$defs/availability_status" },
        last_checked_at: { type: ["string", "null"], format: "date-time" },
        last_success_at: { type: ["string", "null"], format: "date-time" },
        stale_after_seconds: { type: ["integer", "null"], minimum: 1 }
      }
    },
    quality: {
      type: "object",
      required: ["coding_score", "reasoning_score", "speed_score", "recommendation_notes"],
      additionalProperties: true,
      properties: {
        coding_score: { type: ["number", "null"] },
        reasoning_score: { type: ["number", "null"] },
        speed_score: { type: ["number", "null"] },
        recommendation_notes: {
          type: "array",
          items: { type: "string" }
        }
      }
    },
    policy: {
      type: "object",
      required: ["visibility", "tags", "recommended_for_agentic_workflows"],
      additionalProperties: true,
      properties: {
        visibility: { $ref: "#/$defs/visibility" },
        tags: {
          type: "array",
          items: { type: "string" }
        },
        recommended_for_agentic_workflows: { type: ["boolean", "null"] }
      }
    },
    model_offering: {
      type: "object",
      required: [
        "id",
        "object",
        "display_name",
        "canonical_model",
        "description",
        "provider",
        "provider_model_id",
        "endpoint",
        "capabilities",
        "limits",
        "pricing",
        "availability",
        "quality",
        "source_claims",
        "policy"
      ],
      additionalProperties: true,
      properties: {
        id: { type: "string", minLength: 1 },
        object: { const: "model_offering" },
        display_name: { type: "string", minLength: 1 },
        provider: {
          type: "object",
          required: ["id", "name"],
          additionalProperties: true,
          properties: {
            id: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 }
          }
        },
        provider_model_id: { type: "string", minLength: 1 },
        canonical_model: {
          anyOf: [{ type: "null" }, { $ref: "#/$defs/canonical_model" }]
        },
        description: { type: ["string", "null"] },
        endpoint: { $ref: "#/$defs/endpoint" },
        capabilities: {
          type: "array",
          items: { $ref: "#/$defs/capability" }
        },
        limits: { $ref: "#/$defs/limits" },
        pricing: { $ref: "#/$defs/pricing" },
        availability: { $ref: "#/$defs/availability" },
        quality: { $ref: "#/$defs/quality" },
        source_claims: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/source_claim" }
        },
        policy: { $ref: "#/$defs/policy" }
      }
    },
    profile_selection: {
      type: "object",
      required: ["model_offering_id", "selected_at", "expires_at"],
      additionalProperties: true,
      properties: {
        model_offering_id: { type: "string", minLength: 1 },
        selected_at: { type: "string", format: "date-time" },
        expires_at: { type: ["string", "null"], format: "date-time" }
      }
    },
    profile: {
      type: "object",
      required: ["id", "object", "display_name", "description", "selection", "criteria"],
      additionalProperties: true,
      properties: {
        id: { type: "string", minLength: 1 },
        object: { const: "profile" },
        display_name: { type: "string", minLength: 1 },
        description: { type: ["string", "null"] },
        selection: { $ref: "#/$defs/profile_selection" },
        criteria: { type: "object", additionalProperties: true }
      }
    },
    notice: {
      type: "object",
      additionalProperties: true
    }
  }
} as const;
