# ADR 0013: A seller's own free tier outranks an upstream zero price

Status: Accepted

This ADR revises ADR 0006. It changes how the `cline` provider derives a free claim, and it adds a
second fetch to that collector. It does not change the two-provider split that ADR 0006 decided.
See also: ADR 0003 (OpenRouter-slug canonical namespace, which the roster join goes through) and
ADR 0008 (availability semantics, which stays keyed to catalog membership and is untouched here).

## Context

A collector reads a per-token rate of `0` and publishes a free claim. Two cases break that inference,
and both were live.

A reseller republishes another catalog's price list. Cline serves OpenRouter's catalog under
OpenRouter's slugs, so a `:free` variant reads `$0` because that is OpenRouter's price. It is not a
statement about Cline's billing. Cline publishes its own free tier separately, as a `free[]` array on
`api.cline.bot/api/v1/ai/cline/recommended-models`, partly in a `cline-free/` namespace the resold
catalog never lists. The feed published 17 Cline offerings as free at high confidence. Cline's own
free tier held 4. The two sets shared one member.

A model is not billed per token. `google/lyria-3-pro-preview` generates music and bills $0.08 per
song. Its `prompt` and `completion` fields read `"0"` because those fields do not apply to it. The
feed published it as free under both `cline` and `openrouter`. `src/enrichers/models-dev.ts` already
guarded this case; the collectors did not.

## Decision

- **A zero rate is evidence of free only when tokens are the meter.** `tokenPricing` in
  `src/collectors/shared.ts` returns `pricing.kind = "unknown"` with null rates and null `metering`
  when an offering declares a non-text output modality and a zero per-token rate. The `cline`,
  `openrouter`, and `groq` collectors all derive pricing through it, so the rule holds once.
- **A seller's own free list settles free-ness for that seller.** An offering in Cline's `free[]`
  roster publishes `pricing.free.basis = "account_free_tier"` at high confidence, and rates of `0`
  because that is what the account is billed. The catalog's pay-as-you-go rate for the same model is
  recorded in the source claim's `raw_reference` as `catalog_input_usd_per_1m_tokens` and
  `catalog_output_usd_per_1m_tokens`, where it states what the model costs without the tier.
- **`pricing.kind` stays `"free"` for a seller-confirmed free tier**, not `"free_tier"`.
  `isConfidentlyFree` tests `kind === "free"`, so `free_tier` would hide the offering from the `free`
  filter, the Explorer toggle, and the free count. `basis` carries the distinction instead.
- **An unconfirmed zero rate is a low-confidence free claim.** A zero rate in a resold catalog keeps
  `pricing.kind = "free"` and `basis = "zero_priced_model"`, at `confidence: "low"`. The offering stays
  discoverable, and the confidence states that no seller confirmed it.
- **A low-confidence free claim does not satisfy the free filter.** `isConfidentlyFree` in
  `src/feed/classification.ts` now rejects `confidence: "low"`. This gives the field its first
  behaviour; it was written by collectors and read by nothing.
- **A free-roster id the catalog does not list becomes its own offering.** `cline-free/glm-5.2` is
  callable, so the `cline` provider publishes it. Its bare slug joins to the catalog for the display
  name, context, capabilities, and canonical model, the same join ADR 0006 defined for `cline-pass`.
- **The `cline` collector fetches the roster as well as the catalog.** This revises ADR 0006's
  collector-shape decision, which said `cline` fetches only the catalog. The roster is ~4 KB against
  the catalog's ~390 KB, so the added cost does not change that ADR's accepted trade-off.

## Rejected alternatives

### Publish `pricing.kind = "unknown"` for an unconfirmed zero rate

Rejected because it discards a real signal. The rate is published, it is zero, and a reader searching
for cheap capacity wants to see it. Confidence expresses the doubt without deleting the observation.

### Keep the catalog rate on a free-tier offering, as `cline-pass` does

Rejected: a subscription offering has a drain to weight, so a reference rate helps choose between
models on one plan. A free tier has no drain, so the number would only read as a charge that is not
levied. ADR 0006's reference-pricing decision stays scoped to `cline-pass`.

### Detect a non-token meter from the model id or its description

Rejected. `google/lyria-3-pro-preview` states its per-song price in prose, and a router pseudo-model
such as `openrouter/free` states nothing. Output modality is structured, published for every offering,
and already read for the `vision` capability.

### Read the roster's `recommended[]` array as well

Deferred, not built. Its contribution is a curation flag and a `NEW` tag, and its slugs do not match
the catalog: it publishes `zai/glm-5.2` where the catalog holds `z-ai/glm-5.2`. Reading it needs a
creator-prefix-tolerant join that no current requirement justifies.

## Consequences

- The `free` filter returns fewer Cline offerings: 4 seller-confirmed instead of 17 derived. The other
  14 stay in the catalog as low-confidence free claims, reachable by `pricing_kind=free`.
- `pricing.free.confidence` is now load-bearing. A collector that lowers it removes the offering from
  the free filter, so `"low"` must mean "unconfirmed against the seller", never "slightly unsure".
- Two music models move from `free` to `unknown` under both `cline` and `openrouter`, with null rates.
  A reader who wants their price must read the provider's own page.
- A Cline offering can carry `basis = "account_free_tier"` while the same model reads `paid` under
  `openrouter`. That is the intended shape: the free tier belongs to the seller, not the model.
- When the roster fetch fails, the catalog still publishes and every free claim degrades to low
  confidence. The free filter then returns no Cline offering at all, and a notice records why.
