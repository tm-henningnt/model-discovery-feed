# ADR 0003: Use OpenRouter creator/model slugs as canonical model IDs

Status: Accepted

Formalizes `spec/spec-data-model-quality-scores.md`'s REQ-012. See also: ADR 0004, which depends on
this namespace as the join key for cross-provider score propagation.

## Context

The feed exposes the same underlying model through multiple providers. Provider model IDs are not a
stable join key: they can include provider-specific names and OpenRouter variants such as `:free`.
Cross-provider intrinsic-score propagation therefore needs one shared namespace.

## Decision

- Use OpenRouter's creator/model slug namespace for `canonical_model.id`.
- Maintain `src/feed/canonical-aliases.ts` as a checked-in, curated map from
  `provider:provider_model_id` to an OpenRouter slug.
- Strip an OpenRouter model's variant suffix from its canonical ID. For example,
  `openrouter:qwen/qwen3-coder:free` canonicalizes to `qwen/qwen3-coder`.
- Alias matches are high confidence. Unmatched non-OpenRouter offerings keep their provider model-ID
  echo at medium confidence.

## Rejected alternatives

### Use models.dev as the canonical authority

Rejected because models.dev is a valuable cross-reference catalog but its provider/model IDs are not
the namespace this feed already publishes and joins through OpenRouter. It remains evidence for
curating aliases, not the emitted identity.

### Maintain a feed-owned model registry

Rejected because creating and governing a separate naming authority would add ongoing identity and
collision maintenance without improving the consumer-facing OpenRouter integration.

## Consequences

- The alias table is best-effort curated, not a release gate. New unmatched models may ship at
  medium confidence until a verified alias is added.
- Do not map distinct underlying or distill models to one slug. Omit ambiguous candidates and record
  the reason here when encountered.
- The table is refreshed from live collector offerings and cross-referenced against models.dev and
  OpenRouter before adding entries.

### Delisted slug policy

An alias target must exist in the current OpenRouter catalog. When a previously valid slug is
delisted, remove its alias rather than retaining a historical high-confidence join; restore it only
after a live catalog exposes a verified slug for the same underlying model. This policy removed the
delisted Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 3 Pro Preview, Llama 3.2 90B Vision, and
Llama 3.1 405B targets; no unambiguous current replacements were present.

## Deliberately omitted catalog candidates

- Gemini embedding, Imagen, and Veo offerings are omitted when they have no matching OpenRouter
  creator/model slug. Groq Whisper, text-to-speech, and Compound specials are omitted for the same
  reason.
- GitHub Models' Llama 4 FP8 variants are omitted. Mapping them to OpenRouter's non-FP8
  `meta-llama/llama-4-scout` or `meta-llama/llama-4-maverick` slugs would collapse a quantized
  variant and its underlying model into one canonical ID. That is an ambiguous many-to-one mapping,
  so the STOP condition requires leaving those offerings at medium confidence.
