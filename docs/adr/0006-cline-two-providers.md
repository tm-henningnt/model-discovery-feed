# ADR 0006: Model Cline as two providers (pay-as-you-go `cline` and subscription `cline-pass`)

Status: Accepted

See also: ADR 0003 (OpenRouter-slug canonical namespace, which both providers join through) and
ADR 0004 (cross-provider intrinsic-score propagation, which both providers benefit from).

## Context

Cline sells inference two ways over largely the same underlying models: a pay-as-you-go provider
(`cline`) and a fixed-price subscription (`cline-pass`, "ClinePass"). We investigated how to ingest
them (`docs/research/clinepass-models-source.md`). The `cline` catalog is served from a public,
unauthenticated endpoint (`api.cline.bot/api/v1/ai/cline/models`, ~346 models) in OpenRouter's exact
`/models` schema and slug namespace — so it substantially overlaps the `openrouter` provider we
already ingest. The `cline-pass` roster (~10 curated models) lives only in the `clinePass[]` array of
the `recommended-models` endpoint and carries no pricing/context/capability metadata.

## Decision

- **Two separate providers, `cline` and `cline-pass`.** The feed aggregates by provider; the same
  model appearing under `cline`, `openrouter`, etc. is the intended shape (ADR 0004), because the
  consumer question is "which provider I pay for serves this model," not "list each model once." The
  `cline` provider's heavy overlap with `openrouter` is therefore accepted, not deduplicated.
- **`cline` reuses the OpenRouter normalization** against `ai/cline/models`: real per-token pricing,
  context, and capabilities come straight from the payload. Free models fall out of zero pricing
  (`pricing.kind = "free"`) with no special handling. No key is required to collect; `CLINE_API_KEY`
  is recorded on the provider as the credential for *using* it and sent as an optional bearer header.
- **`cline-pass` pricing is `subscription_included`**, with `input`/`output` filled from the
  **live `cline` catalog join** (the underlying model's pay-as-you-go rate), kept purely as a
  cheap-vs-expensive signal — not an amount billed. Each ClinePass offering records the
  ClinePass-specific facts under `pricing.subscription`: `billing: "flat_monthly"`,
  `per_token_billed: false`, `reference_pricing: true`, and `quota_multiplier_vs_payg: "2-5x"` (the
  ~2–5× usage headroom over pay-as-you-go, the only ClinePass-specific pricing fact that exists).
- **Both providers get high-confidence canonical IDs**, so ADR 0004 propagates intrinsic scores onto
  them. `cline` ids are already OpenRouter slugs (strip the `:free` variant suffix). `cline-pass`
  slugs (`cline-pass/glm-5.2`) are canonicalized in-collector via their exact match in the `cline`
  catalog (`z-ai/glm-5.2`), rather than by hand-added alias-table entries.
- **Collector shape:** one module `src/collectors/cline.ts` exporting two collectors. `cline` fetches
  the catalog; `cline-pass` fetches the `recommended-models` endpoint (for `clinePass[]`) plus the
  catalog (for the enrichment join). The catalog is fetched twice per run (~400 KB, daily cadence);
  accepted to keep each collector self-contained rather than sharing cross-collector state.

## Rejected alternatives

### Fold `cline` into flags on the existing OpenRouter offerings

Rejected because per-provider availability is the product: a consumer paying for Cline needs Cline as
its own provider, and tagging OpenRouter records would both pollute one provider with another's policy
and fail to represent Cline-served models that don't map onto an existing OpenRouter offering.

### Source `cline-pass` reference pricing from the docs `.md` table

Rejected: the docs' hand-maintained reference table had already drifted from the live catalog. The
catalog join is fresher, structured (no markdown parse), and consistent with the `cline` offering of
the same model.

### A generic "manual / static source" collector for API-less providers

Deferred, not built. Both Cline surfaces turned out fully API-backed, so nothing in scope needs it;
building it now would guess a shape from no real case. Revisit when a genuinely API-less provider
appears.

## Consequences

- The catalog carries a `cline` provider that largely mirrors `openrouter`; this is deliberate
  aggregation, and a reader should not "fix" it by deduplicating.
- `cline-pass` offerings show per-token numbers despite being subscription-billed; `pricing.kind`
  distinguishes them, and the numbers are documented as a reference signal only.
- If a ClinePass slug ever stops matching a `cline` catalog entry, its pricing/context land null and
  its canonical ID falls back to a medium-confidence echo (no score propagation) until the match is
  restored.
