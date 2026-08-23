# ADR 0017: Ingest the whole Venice catalog and let the meter say how each type bills

Status: Accepted

Adds the `venice` collector. See also: ADR 0003 (canonical namespace), ADR 0007 (the same
one-catalog-many-meters problem at QwenCloud), ADR 0008 (availability), ADR 0013 (free claims).

## Context

Venice is an OpenAI-compatible, privacy-first provider at `https://api.venice.ai/api/v1`. One
endpoint, `GET /models?type=all`, returns the whole catalog: 328 offerings across nine types
(`text`, `embedding`, `tts`, `asr`, `image`, `inpaint`, `upscale`, `music`, `video`).

The catalog raises four problems.

1. Venice bills each type on its own meter. Text and embedding models bill per token. TTS bills per
   million characters. ASR bills per audio second. Image, inpaint, and upscale bill per image, and
   several publish a price matrix per resolution and quality rather than one figure. Music bills per
   second, per thousand characters, or per generation. Video models publish no price at all.
2. Venice publishes prices in USD per million tokens. Every other collector reads a per-token rate.
3. Venice runs its own id namespace that flattens the dots in a model name. Its Gemini 3.6 Flash is
   `gemini-3-6-flash`, and its GPT-5.2 is `openai-gpt-52`. Neither matches an OpenRouter slug.
4. The catalog endpoint needs no credential. It answers HTTP 200 with no `Authorization` header, and
   it ignores an invalid one.

## Decision

- Publish every one of the nine types as an offering. The type drives capabilities, metering,
  endpoint protocol, and the policy tag, which is the rule ADR 0007 set for QwenCloud.

- Read `pricing.input.usd` and `pricing.output.usd` as USD per million tokens, verbatim. Do not
  reuse `shared.tokenPricing`: it expects a per-token rate and multiplies by a million.

- For a meter the contract cannot carry, state `pricing.kind = "paid"` with null token rates and let
  `pricing.metering` name the unit. Record the observed unit price in the source claim's
  `raw_reference`, under `unit_price_usd` and `unit_price_unit`. A model with a price matrix records
  no unit price, because no one figure describes it.

- Set `protocol = "openai_chat_completions"` for a `text` model only. Venice serves the other eight
  types through other request shapes, so their protocol is `unknown` and their `base_url` is null.

- Derive text capabilities from `model_spec.capabilities`. That object enumerates function calling,
  response schema, reasoning, vision, and audio input on every text model, so absence there is a
  denial. `capabilityGapFillAllowed.venice` is therefore `false`.

- Read `model_spec.deprecation.removesAt` as ADR 0008 precedence rule (b): a date in the past gives
  `retired`, and a date in the future gives `deprecated`.

- Read a token rate of zero as `pricing.kind = "free"` with basis `zero_priced_model` at high
  confidence. Venice sets its own price schedule and marks the underlying model up, so a zero is
  Venice's own claim about its own bill, not a republished upstream rate (ADR 0013).

- Bind the id namespace with 85 curated entries in `src/feed/canonical-aliases.ts`, as ADR 0003
  requires. Each entry was built by comparing the Venice id and the OpenRouter slug with all
  punctuation removed, rejecting any Venice id that matched more than one slug, and confirming the
  match against both display names. `capabilityGapFillAllowed` stays off, but `models.dev` keys its
  `venice` provider on the same ids, which supplies release dates, knowledge cutoffs, and
  descriptions for 100 text models.

- Send `VENICE_AI_API_KEY` when it is set, and run without it when it is not. The GitHub Actions
  secret is optional.

- Record Venice's privacy tier as a policy tag: `privacy-private`, `privacy-anonymized`,
  `privacy-tee`, or `privacy-e2ee`. The tier is why a consumer picks Venice over a cheaper reseller,
  and the contract has no field for it.

## Rejected alternatives

### Publish only the text models

Rejected because Venice sells the other 215 offerings on the same key and the same base URL. Hiding
them would answer "which providers serve this model" with a smaller catalog than the provider's own.

### Add a `characters` or `audio_seconds` rate field to the contract

Rejected because it changes a published schema for one provider. `pricing.metering` already names
the unit, and the source claim carries the figure. Revisit when a second provider needs the same
field.

### Treat a quantized deployment as a distinct canonical model

Rejected. Venice discloses `capabilities.quantization` for the open-weights models it self-hosts,
which is the precision of Venice's deployment rather than a different model. This is not the case
ADR 0003 refused: GitHub Models published a separate model id for the FP8 and the non-FP8 build of
one model, so aliasing both collapsed two ids into one canonical id. Venice publishes one id per
model. The precision is carried as a `quantization-*` policy tag instead.

### Read `created` as the model's release date

Rejected. Venice documents `created` as "Release date on Venice API" — the day the model reached
Venice, not the day the model shipped. `canonical_model.release_date` describes the underlying model,
so it stays null and `models.dev` fills it.

## Consequences

- The feed grows from 1298 to 1626 offerings. 328 are Venice, and 116 of those are video models that
  carry no capability term, because the capability enum has none for video. They are discoverable by
  the `video-generation` policy tag.

- 85 of the 113 Venice text offerings join the canonical namespace at high confidence, so
  cross-provider score propagation (ADR 0004) reaches them. 61 carry an Artificial Analysis coding
  score on the first run.

- The 28 unmatched text ids are private (`-p`) and uncensored fine-tunes with no OpenRouter
  counterpart. They stay at medium confidence, as ADR 0003 intends.

- The alias table needs a refresh when Venice adds models. An unmatched offering ships at medium
  confidence and is not a release gate.
