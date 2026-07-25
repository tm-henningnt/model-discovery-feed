# Model Discovery Feed

A feed that aggregates AI model offerings across many providers into one catalog, so a
consumer can see where a given model can be bought or run and at what price.

## Language

**Provider**:
A place where you can buy or run inference — a marketplace or API you pay (or subscribe) to.
Distinct from the company that *made* the model. The same underlying model is typically sold by
several providers.
_Avoid_: vendor, source, host

**Offering**:
One model as sold by one provider — the unit the feed publishes (`ModelOffering`). The same
underlying model appears as many offerings, one per provider that serves it. This overlap is the
point of the feed, not duplication to be removed: it answers "which providers serve this model, and
for how much."
_Avoid_: model (ambiguous — an offering is a model *at a provider*), listing, record

**Canonical model**:
The provider-independent identity shared by every offering of the same underlying model, keyed by
OpenRouter's creator/model slug (see ADR 0003). The join key that lets intrinsic quality scores
propagate across providers (ADR 0004).

**Cline**:
The pay-as-you-go Cline provider — per-token billing over a catalog it resells in OpenRouter's
shape and slug namespace.
_Avoid_: ClinePass (that is the separate subscription provider below)

**ClinePass**:
Cline's flat-rate subscription provider: a fixed monthly price for a curated roster of the same
underlying models, not billed per token. Its offerings carry `pricing.kind = "subscription_included"`
with the underlying model's per-token rate kept only as a cheap-vs-expensive signal (see ADR 0006).
_Avoid_: Cline (that is the separate pay-as-you-go provider above)

**QwenCloud**:
Alibaba's international Qwen platform (Singapore) as a pay-as-you-go provider — per-token, per-image, or
per-second billing over a 250-model marketplace that also resells DeepSeek, GLM, Kimi, and MiniMax
models. Its roster comes from a public CDN model-id mapping, not a catalog API (see ADR 0007).
_Avoid_: DashScope, Model Studio, Bailian (former names for the same platform)

**Token Plan**:
QwenCloud's flat-rate subscription provider: a fixed monthly price for a curated roster, metered in
**Credits** rather than tokens. Its offerings carry `pricing.kind = "subscription_included"` with
`metering: "credits"` and **null** per-token rates, because QwenCloud publishes no per-model Credits
coefficient (see ADR 0007). Sold in two editions, Personal and Team, with different rosters; each
offering records the editions that include it in `pricing.subscription.plan_editions`.
_Avoid_: Coding Plan (a separate QwenCloud subscription this feed does not yet ingest), QwenCloud (that
is the separate pay-as-you-go provider above)

**Plan edition**:
One price tier of a subscription provider, with its own roster (Token Plan Personal vs Team). An edition
is a property of the sale, not a provider — the same model in both editions is one offering carrying two
edition tags.
