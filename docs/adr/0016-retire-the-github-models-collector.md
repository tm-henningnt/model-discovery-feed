# ADR 0016: Retire the GitHub Models collector

Status: Accepted

This ADR removes the `github-models` collector. It does not change the availability semantics of
ADR 0008, which governed the offerings while the endpoint was failing. It keeps one contract value
the collector introduced. See also: ADR 0003 (the OpenRouter-slug canonical namespace the removed
aliases pointed into).

## Context

`https://models.github.ai/catalog/models` returns HTTP 410 with
`{"code": "github_models_retirement_brownout"}`. GitHub is retiring the product. Every refresh run
emitted a `collector unavailable` notice, and the feed published a `github-models` provider entry with
zero offerings.

ADR 0008 handled the outage correctly on its own terms. A `collector unavailable` notice carries the
previous release's offerings forward, so a transient failure never shrinks a roster. The 55 offerings
then aged through `unknown` to `retired` and dropped after the 7-day retirement window. By the time
of this decision the feed carried zero `github-models` offerings, so the retirement needs no data
migration and no tombstone pass.

What remained was a collector that could only fail, a provider entry that described nothing, a
`collector unavailable` notice on every run, and 22 canonical aliases whose keys no offering could
match. Those aliases also produced a recurring `alias targets not found` notice from `canonicalize`.

## Decision

- **Delete the collector, its test, and its registration.** `src/collectors/github-models.ts` and its
  entry in `collectors` are removed, along with `"github-models"` from the `CollectorId` union.
- **Delete the 22 `github-models:` canonical aliases.** Their keys cannot match an offering, and they
  were a standing source of the `alias targets not found` notice.
- **Delete the two enricher map entries.** `github-models` is removed from
  `modelsDevProviderByProviderId` and `capabilityGapFillAllowed`. It was never in
  `pricingGapFillAllowed`, which ADR-adjacent research (`docs/research/github-models-pricing.md`)
  decided deliberately; that decision needs no reversal, only deletion of its subject.
- **Keep `github_models` in `endpointProtocolSchema` and in the published JSON Schema.** This is the
  load-bearing part of this ADR. `src/feed/store.ts` and `src/collectors/publish.ts` re-validate a
  stored release snapshot on read, through the *current* `feedDocumentSchema`. A snapshot published
  before the brownout contains offerings with `endpoint.protocol = "github_models"`, and
  `endpointProtocolSchema` is a strict `z.enum`. Removing the value would make every historical
  revision fail validation on read, so `/v1/feed-revision` would start throwing on old revisions.
  The value stays until no stored snapshot uses it.
- **Keep the `github_models` label in `app/lib/format.ts`** so a historical revision still renders a
  readable protocol name rather than a raw token.
- **Drop `GH_MODELS_TOKEN` from the refresh workflow** and from `docs/deployment.md`. The same edit
  syncs that document with the workflow's actual env block, which had drifted.

## Rejected alternatives

### Keep the collector and suppress the notice during the brownout

Rejected. It preserves a code path that cannot succeed and leaves a provider entry that describes no
purchasable capacity. The notice is not the problem; the dead collector is.

### Remove `github_models` from the protocol enum along with the collector

Rejected, and it is the trap this ADR exists to record. The enum is not write-only. It validates
stored snapshots on read, so it is part of the feed's *historical* contract, not only its current one.
Narrowing it breaks reads of releases the feed already published.

### Delete `docs/research/github-models-pricing.md`

Rejected. It is a dated research note that records why `github-models` stayed out of
`pricingGapFillAllowed`, with primary sources. It reads as a record of an inquiry, not as a
description of current behaviour, so it does not go stale.

## Consequences

- The feed publishes nine providers instead of ten. No offering count changes, because the provider
  already carried zero offerings.
- Two recurring notices stop: `github-models` `collector unavailable`, and the `canonicalize`
  `alias targets not found` entries for `github-models:` keys.
- `endpointProtocolSchema` now holds a value no collector can produce. That is intentional. A future
  change that prunes the enum must first confirm that no stored snapshot carries the value, because
  the read path validates against the live schema.
- `GH_MODELS_TOKEN` can be deleted from the repository secrets. Nothing reads it.
