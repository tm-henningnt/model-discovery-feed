# ADR 0012: Publish the plan edition as a filter dimension

Status: Accepted

This ADR extends ADR 0007. It does not change the provider split that ADR decided.

## Context

QwenCloud sells Token Plan in two editions. Personal covers 11 models. Team covers 22. The Personal
roster is a subset of the Team roster.

ADR 0007 put both editions under one provider, `qwencloud-token-plan`, holding the union. It recorded
the editions per offering in `pricing.subscription.plan_editions` and as `token-plan-personal` /
`token-plan-team` entries in `policy.tags`. That data was correct from the first run, and nothing read
it.

The result was a trap on both surfaces. A Personal subscriber who filtered the explorer by provider
"QwenCloud Token Plan" saw 22 offerings and could call 11. A feed consumer that routed work by
provider id over-selected the same way. Neither surface offered a way to say which edition the user
holds:

- `pricing.subscription` was `z.record(z.unknown())` in the Zod contract and
  `additionalProperties: true` in the published JSON Schema, so `plan_editions` was not part of the
  contract. `docs/public/model-discovery-feed.md` told consumers to read `pricing.subscription` for
  the plan facts, but the contract specified no key there.
- `/v1/models` had no parameter for an edition or a tag.
- The explorer had no edition facet, and its results table showed only the provider name.

The defect was exposure, not collection.

## Decision

- **Name `plan_editions` in the contract.** `pricing.subscription` becomes a passthrough object with
  one named key, `plan_editions: string[]`. Every other key stays legal and unnamed, because the three
  collectors that emit a subscription (`qwencloud`, `cline`, `opencode`) each carry different facts.
  `plan_editions` is named because it is the one key a consumer must read to route correctly. The
  published JSON Schema mirrors this and keeps `additionalProperties: true`.
- **`schema_version` stays `1.0.0`.** Naming a field the feed already emitted is additive, and the
  document is `.passthrough()` by design. Consumers that ignored the key keep working.
- **Two query parameters on `/v1/models`, both comma-separated OR-lists.** `plan_edition` reads
  `pricing.subscription.plan_editions`. `tag` reads `policy.tags`. `plan_edition` names the concept, so
  a caller does not have to know a tag spelling. `tag` is generic, so the tags the feed already
  publishes (`image-generation`, `video-generation`, `token-plan`) become filterable at the same time.
- **OR semantics, not AND.** `plan_edition=personal,team` returns the union of both rosters. AND would
  return the overlap, which for a subset relation is the smaller roster — the opposite of what a
  caller who names two editions asks for. `capabilities` keeps AND semantics, because a caller there
  asks for one model that does several things.
- **One explorer facet, "Plan edition", built from the same field.** It renders only when the feed
  carries a multi-edition plan, so it disappears if Token Plan leaves the feed. Its counts follow the
  existing rule: a facet ignores its own selection and respects every other.
- **The edition is visible in the results table,** as chips beside the provider name. A user who never
  opens the detail panel still sees that one provider name covers two rosters.

## Rejected alternatives

### Split Personal and Team into two providers

Rejected again, on ADR 0007's reasoning. The two editions are price tiers of one subscription, sold
from one base URL with one key namespace. Splitting them duplicates the 11 shared offerings to encode
a tier, and an offering is a model at a provider.

### Rename the provider to make the union obvious

A name like "QwenCloud Token Plan (Personal + Team)" states the problem without solving it. The user
still cannot reduce the list to the 11 models they pay for, and a feed consumer gains nothing.

### Ship `tag` alone

`tag=token-plan-personal` already answers the question, and it is one parameter instead of two.
Rejected because a tag is an untyped string with no schema and no guarantee of spelling. A consumer
would bind to the string `token-plan-personal` rather than to the edition concept, and a provider that
renames its editions would break that consumer silently. `plan_edition` reads the typed field.

### Model plan editions relationally

An `Edition` table with a join to offerings would make the roster queryable in SQL. Rejected as
premature: `plan_editions` lives inside the existing `PricingObservation.subscription` and
`FeedRelease.snapshotJson` JSON columns, no query in this repo needs SQL-side edition filtering, and
the feed is read as a document.

## Consequences

- A consumer that filters only by `provider=qwencloud-token-plan` still over-selects. The contract doc
  and the client integration guide now both carry the caution, but the old behaviour is unchanged for
  a client that does not adopt the parameter. This is deliberate — silently narrowing the provider
  filter would break consumers who want the union.
- `plan_editions` is a provider-supplied string array, not an enum. A new edition in QwenCloud's docs
  appears in the feed and in the explorer facet with no code change. `planEditionLabel` title-cases an
  unmapped value.
- The published fixtures now include a `subscription_included` offering carrying
  `pricing.subscription.plan_editions`. Before this change no fixture did, so the shape consumers were
  told to read was untested at the contract boundary.
- `tag` filters every tag the feed publishes, not only plan editions. That is intended reach, but it
  means a tag rename is now a consumer-visible change.
