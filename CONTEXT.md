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
