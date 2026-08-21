# ADR 0015: A zero rate on a plan roster reads as free

Status: Accepted

This ADR extends ADR 0013, which decided how a zero per-token rate becomes a free claim. It changes
the `pricing.kind` a zero rate promotes from, in `src/enrichers/models-dev.ts`. It does not change
ADR 0013's confidence rules, and it does not change the `cline` collector.
See also: ADR 0006 and ADR 0007 (the two-provider splits that create the plan rosters this rule
applies to) and ADR 0012 (plan editions).

## Context

A flat-rate plan provider sells a curated roster for a fixed monthly price. Its collector stamps
every offering `pricing.kind = "subscription_included"`, because the reader pays the plan, not the
token. The provider's listing endpoint carries no rates, so `models.dev` gap-fills a reference rate
per model. ADR 0006 decided that a reference rate helps a reader choose between models on one plan.

OpenCode Go published `ox-alpha-free` at a rate of `0`. It was the only zero rate in a roster of 27,
where every other model carried a real reference rate. The model is callable without the Go plan.
The feed published it as `subscription_included` with rates of `0` and `pricing.free = null`, because
the gap-fill promoted a zero rate to `free` only from `pricing.kind = "unknown"`.

The consequence was silent. `isConfidentlyFree` tests `kind === "free"`, so the offering was absent
from the free filter, the Explorer free toggle, and the free count, while still listed and available.
A reader looking for free capacity could not find it. `explainPricing` told the reader the model was
"covered by a subscription or flat-rate plan", which named a purchase the reader did not have to make.

## Decision

- **A gap-filled rate of `0` promotes `subscription_included` to `free`.** A plan roster states a
  reference rate per model, so a rate of `0` on one member states that this member costs nothing. The
  promotion set is now `unknown` and `subscription_included`. Every other `pricing.kind` is left
  alone, so a first-party `paid` rate of `0` is still not rewritten.
- **The promotion carries ADR 0013's basis and confidence.** The offering publishes
  `basis = "zero_priced_model"` at `confidence: "medium"`, the same values a zero-rate OpenCode Zen
  model already published. No seller confirmed the rate against its own billing, so it does not earn
  `high`, and `models.dev` is not reselling another catalog's price list, so it does not earn `low`.
- **A promoted offering drops `pricing.subscription`.** A free offering has no plan to drain, so the
  block would read as a purchase the reader must make. The gap-fill claims `pricing.subscription`
  in `field_paths` when it removes the block.
- **The rule holds only where pricing gap-fill is enabled.** `pricingGapFillAllowed` stays off for
  `qwencloud-token-plan`, whose every `models.dev` rate is a literal `0` because the plan meters
  Credits. That roster states no reference rate, so it never reaches this promotion.
- **`models.dev` `description` gap-fills into a null description.** The blurb is the evidence
  `derive-coding-capability` reads for a model whose id and display name name no coding keyword.
  `ox-alpha-free` is described as a model "for coding, agentic tasks, and tool use" and carried no
  `coding` capability.

## Rejected alternatives

### Give the promoted claim `confidence: "low"`

Rejected. ADR 0013 reserves `low` for a rate a reseller republishes from an upstream catalog, where
the number says nothing about the seller's own billing. `models.dev` publishes OpenCode's own rates
for OpenCode's own roster, and the surrounding 26 rates are real. A `low` claim would fail the free
filter, which is the defect this ADR fixes.

### Keep `subscription_included` and teach the free filter to read the rates

Rejected. It would put the zero-rate rule in the filter as well as the enricher, so a consumer
reading `pricing.kind` from the published feed would still see the wrong value. `pricing.kind` is the
field the contract publishes; it has to be right at the source.

### Have the OpenCode collector stamp `unknown` for a `-free` suffixed id

Rejected. It infers billing from a naming convention. `muse-spark-1.2-contributor` carries no suffix
and `openrouter/free` is a router pseudo-model, so the suffix neither implies free nor is required
by it. The rate is published; read the rate.

## Consequences

- `opencode-go:ox-alpha-free` moves from `subscription_included` to `free` and enters the free filter,
  the Explorer free toggle, and the free count. It was the only offering in the feed that published
  rates of `0` with a non-`free` kind.
- A plan provider that starts pricing a model at `0` now changes that offering's `pricing.kind`
  without a code change. A plan that prices its whole roster at `0` would read as entirely free, which
  is why `pricingGapFillAllowed` remains the gate.
- The `description` gap-fill added the `coding` capability to 37 offerings across six providers, each
  from a blurb that names coding. No offering lost the capability.
- `pricing.subscription` is now absent from an offering whose plan lists it. A consumer that reads the
  block to route a plan call must key on `pricing.kind = "subscription_included"`, not on the block.
