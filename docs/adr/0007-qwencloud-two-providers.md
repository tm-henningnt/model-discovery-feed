# ADR 0007: Model QwenCloud as two providers (`qwencloud` and `qwencloud-token-plan`)

Status: Accepted

See also: ADR 0003 (OpenRouter-slug canonical namespace), ADR 0004 (cross-provider intrinsic-score
propagation), and ADR 0006 (the same two-provider split for Cline, which this ADR follows and departs
from on one point). Source discovery is recorded in `docs/research/qwencloud-models-source.md`.

## Context

QwenCloud is Alibaba's international Qwen platform (Singapore). It sells inference two ways over
overlapping models: a pay-as-you-go marketplace and Token Plan, a flat monthly subscription for AI
coding tools. Unlike Cline it publishes **no unauthenticated catalog API** — the marketplace grid reads a
console gateway that needs a session cookie, and `/compatible-mode/v1/models` needs an API key. What it
does publish without auth is a CDN model-id mapping, a pricing doc, and one Markdown roster table per
Token Plan edition.

## Decision

- **Two separate providers, `qwencloud` and `qwencloud-token-plan`,** for the same reason as ADR 0006:
  the consumer question is "which provider I pay for serves this model", so the overlap between them
  (and with `openrouter`) is the product, not duplication to remove.
- **`qwencloud` takes its roster from the marketplace CDN mapping**
  (`https://alioth-intl.alicdn.com/model-mapping`, 250 ids, no auth) and its rates from the first-party
  pricing doc (`.../getting-started/pricing.md`). The doc covers only representative models, so a
  token-billed model without a documented rate stays `pricing.kind = "unknown"` and the models.dev
  gap-fill completes it (`qwencloud` → models.dev `alibaba`). Plan 030's rule still holds: a non-null
  first-party rate is never overwritten.
- **`qwencloud-token-plan` takes its roster from the two edition docs**, the only source that separates
  Personal (11 models) from Team (22). The provider holds the union, and each offering records which
  editions include it in `pricing.subscription.plan_editions` plus a `token-plan-personal` /
  `token-plan-team` policy tag. One offering per model, not one per edition — an offering is a model at
  a provider, and the edition is a property of the sale, not a second provider.
- **Token Plan pricing is `subscription_included` with null per-token rates and
  `metering: "credits"`.** This is where we depart from ADR 0006: ClinePass carries the underlying
  model's pay-as-you-go rate as a cheap-vs-expensive reference signal, but Token Plan meters in Credits
  with a per-model deduction coefficient QwenCloud does not publish. A per-token number would therefore
  be an invented unit, so `pricing.subscription` states the facts that do exist
  (`billing: "flat_monthly"`, `per_token_billed: false`, `reference_pricing: false`,
  `credits_metered: true`, `interactive_use_only: true`) and the rate fields stay null. The
  cheap-vs-expensive comparison is still available through the canonical join to the same model's
  `qwencloud` or `openrouter` offering.
- **Canonical ids come from a live segment join, not a hand-maintained alias table.** QwenCloud ids are
  the bare model segment of an OpenRouter slug (`glm-5.2` for `z-ai/glm-5.2`), so `canonicalize` binds
  an id at high confidence when exactly one live OpenRouter slug shares that segment, and refuses the
  bind with a notice when two creators share it (the distinct-to-one mapping ADR 0003 forbids). This is
  the same live-join reasoning ADR 0006 used for ClinePass, applied through the enricher because the
  collector cannot see the OpenRouter catalog. Unmatched ids keep a medium-confidence echo.
- **Modality drives capabilities, metering, and protocol.** The CDN mapping carries only ids, so the
  collector classifies each id (text, vision, omni, image, video, speech, embedding, rerank) and derives
  capabilities, `pricing.metering` (`tokens` / `images` / `video_seconds` / `characters` /
  `audio_seconds`), and endpoint protocol from the class. `openai_chat_completions` is claimed only for
  text, vision, and omni models; image, video, speech, and embedding models are served by other
  DashScope shapes, so their protocol is `unknown` and their `base_url` is null.
- **A non-token-billed offering is `paid` with null rates.** The contract has only per-1M-token rate
  fields, so an image or video model states `kind: "paid"` and lets `metering` say which unit applies.
  The models.dev pricing gap-fill now also skips any offering whose `metering` is not `tokens` — a
  general guard, because models.dev states one number per model and writing it into the token fields
  would contradict `metering`.

## Rejected alternatives

### Scrape the marketplace model detail pages

`https://www.qwencloud.com/models/<id>` is server-rendered and does carry price, context, and rate
limits. Rejected: 250 HTML fetches per run against markup with hashed CSS-module class names, for data
models.dev already serves as JSON. The page URL is kept on each source claim so a reader can verify a
rate by hand.

### Use models.dev as the roster source instead of the CDN mapping

Rejected on provenance: models.dev is a third-party catalog and covers 51 of 250 marketplace models. It
stays what it already is in this repo — an enricher that gap-fills a first-party roster.

### Treat Token Plan Personal and Team as separate providers

Rejected. They are two price tiers of one subscription with different rosters, sold from one base URL
with one key namespace. Splitting them would duplicate 11 offerings to encode a tier.

### Hand-maintain canonical aliases for QwenCloud, as plan 046 did for OpenCode

Rejected at this scale: 46 of 250 ids match an OpenRouter slug today, and the marketplace adds models
continuously. A verified-once table of ~92 entries would drift, and the live join is checkable every run.

## Consequences

- 104 of 250 `qwencloud` offerings publish `pricing.kind = "unknown"` — models neither the first-party
  doc nor models.dev prices. That is an honest gap, not a defect to paper over.
- Token Plan offerings show no per-token number at all, so a price-ranked view sorts them by their
  canonical twin's rate or not at all. This is deliberate; see the pricing decision above.
- The segment join is opt-in per provider (`SEGMENT_JOIN_PROVIDER_IDS` in `src/enrichers/canonicalize.ts`).
  Adding another provider whose ids are bare model segments means adding it to that set, not writing a
  table.
- QwenCloud's Token Plan terms forbid non-interactive API automation. The feed records that as
  `pricing.subscription.interactive_use_only`, so a consumer routing batch work does not pick it by
  accident.
