---
title: Model Quality Scores, Canonicalization, and Delegation Profiles
version: 1.0
date_created: 2026-07-11
owner: Henning Naarlien-Tolpinrud
tags: [data, schema, feed, collectors, ranking, ui]
---

# Introduction

This specification defines how the model discovery feed acquires, stores, propagates, and exposes
model quality scores (coding, reasoning, agentic, speed) and enriched model metadata, and how those
scores drive ranking and delegation profiles. The end goal: a feed consumer — a human or an
orchestrating agent (Claude/Codex) — can pick the right provider and model for a task based on task
type, difficulty, required capabilities, speed, and price, and build standing delegation rules from it.

All decisions herein were settled with the maintainer on 2026-07-11 (grilling session following
`docs/research/model-quality-sources.md`). This spec records them; it does not reopen them.

## 1. Purpose & Scope

**In scope:**

- Mapping Artificial Analysis (AA) benchmark indexes from OpenRouter's embedded `benchmarks` field.
- A direct Artificial Analysis API integration (scores incl. speed/TTFT, per-endpoint where offered).
- models.dev enrichment (capability/limit gap-filling, knowledge cutoff, release date, open weights).
- Canonicalization of `canonical_model.id` into the OpenRouter slug namespace via a curated alias table.
- Cross-provider propagation of model-intrinsic scores.
- Carry-forward staleness handling for the AA snapshot.
- Attribution (feed, UI, docs) for AA, Design Arena, and models.dev.
- Quality-first default ranking; delegation profiles `best-coder`, `best-agentic`, `fastest-coder`,
  `best-value-coder`; score-aware `best-free-coder`; explorer surfacing; export presets.

**Out of scope:** LMArena/HELM/LiveBench/Epoch integrations (documented as rejected-for-now in the
research note); paid AA tiers; per-region speed data.

**Audience:** implementing agents and reviewers. Assumes familiarity with `src/feed/schema.ts` and the
collector pipeline (`src/collectors/*`, `scripts/run-collectors.ts`, `src/collectors/publish.ts`).

## 2. Definitions

- **Offering**: one model as served by one provider (`ModelOffering`), id `provider:provider_model_id`.
- **Canonical model**: the underlying model an offering serves, identified by `canonical_model.id`.
- **AA**: Artificial Analysis (artificialanalysis.ai). **Index**: AA's 0–100 aggregate scores
  (`intelligence_index`, `coding_index`, `agentic_index`, `math_index`).
- **OpenRouter embed**: the `benchmarks` object inside OpenRouter `/api/v1/models` entries, containing
  `artificial_analysis` indexes and `design_arena` Elo data.
- **Intrinsic score**: a property of the model itself (coding, reasoning, agentic, math, sub-benchmarks).
- **Endpoint score**: a property of a provider's serving of the model (tokens/sec, TTFT).
- **Propagation**: copying intrinsic scores from a scored offering to other offerings of the same
  canonical model.
- **Alias table**: checked-in map from `provider:provider_model_id` to canonical OpenRouter slug.
- **Carry-forward**: republishing the last successful AA snapshot when a fresh fetch fails.
- **TTFT**: time to first token, seconds.

## 3. Requirements, Constraints & Guidelines

### Scores & schema

- **REQ-001**: `quality.coding_score` ← AA `coding_index`, verbatim (0–100 scale, no rescaling).
- **REQ-002**: `quality.reasoning_score` ← AA `intelligence_index`, verbatim (0–100).
- **REQ-003**: `quality.agentic_score` (new field) ← AA `agentic_index`, verbatim (0–100).
- **REQ-004**: `quality.speed_score` ← AA `median_output_tokens_per_second`, verbatim (absolute
  tokens/sec, NOT 0–100). Endpoint-matched only (see REQ-013).
- **REQ-005**: New `quality.benchmarks` object (nullable) carrying, all verbatim:
  `math_score` (AA `math_index`), `ttft_seconds` (AA median TTFT, endpoint-matched only),
  `artificial_analysis` (map of AA sub-benchmark name → score, e.g. `mmlu_pro`, `gpqa`,
  `livecodebench`, `scicode`, `math_500`, `aime`), `design_arena` (per-category `{elo, rank, win_rate}`
  from the OpenRouter embed).
- **REQ-006**: `canonical_model` gains nullable `knowledge_cutoff` (ISO date string), `release_date`
  (ISO date string), `open_weights` (boolean) — sourced from models.dev.
- **CON-001**: All score values are stored exactly as published by their source ("verbatim, documented
  units"). No normalization, blending, or invented scales in stored data. Units are documented in the
  zod schema comments, the published JSON Schema descriptions, and the docs page.
- **CON-002**: The three pre-existing top-level slots (`coding_score`, `reasoning_score`,
  `speed_score`) remain the headline contract; new detail nests beside them. No renames, no removals.

### Sources & precedence

- **REQ-007**: The OpenRouter collector maps the OpenRouter embed into `quality.*` for `openrouter:*`
  offerings.
- **REQ-008**: A new AA enricher fetches AA's `/data/llms/models` (auth: `x-api-key:
  ARTIFICIALANALYSIS_API_KEY`) once per pipeline run and maps indexes, sub-benchmarks, speed, TTFT.
- **REQ-009**: When both the AA direct API and the OpenRouter embed carry the same index for the same
  canonical model, the AA direct value wins (it is the origin; the embed is a republication).
- **REQ-010**: A new models.dev enricher fetches `https://models.dev/api.json` and fills ONLY fields
  the provider's own API left null/absent: capability booleans (`tool_call` → `tool_use`, `reasoning`,
  `attachment` → `vision`), `limits.context_tokens`, `limits.max_output_tokens`, plus REQ-006 fields.
  Their provider key `google` maps to our `gemini`.
- **CON-003**: First-party provider API data is authoritative for whatever it explicitly states.
  models.dev never overwrites a non-null provider-sourced value. Pricing disagreements between
  models.dev and a provider produce a feed notice, never an override.
- **REQ-011**: `ARTIFICIALANALYSIS_API_KEY` is added to `.env.example` and to the env block of
  `.github/workflows/refresh-model-feed.yml` (secret already exists in GitHub).

### Canonicalization & propagation

- **REQ-012**: `canonical_model.id` uses the OpenRouter creator/model slug namespace (e.g.
  `meta-llama/llama-3.3-70b-instruct`). Matching for non-OpenRouter offerings goes through a
  checked-in curated alias table (`src/feed/canonical-aliases.ts`), seeded from models.dev
  cross-references. Alias-matched offerings get `canonical_model.confidence: "high"`; unmatched
  offerings keep their provider model id echo at `"medium"`.
- **REQ-013**: Intrinsic scores (coding, reasoning, agentic, math, sub-benchmarks, design arena)
  propagate to every offering sharing the canonical model id. Endpoint scores (`speed_score`,
  `ttft_seconds`) NEVER propagate; they are set only from AA endpoint data matched to that specific
  provider (AA's Groq endpoint measurements → `groq:*` offerings), else stay null.
- **REQ-014**: Every enriched or propagated field gets a `source_claims` entry: `source_type:
  "third_party_catalog"`, `source_url` pointing at the owning source, a `raw_reference` JSON pointer
  into the source snapshot. Direct measurements carry `confidence: "high"`; propagated values carry
  `confidence: "medium"` and a `raw_reference` recording the canonical join (which offering the score
  came from).

### Staleness

- **REQ-015**: The last successful AA response is persisted as a source snapshot (existing
  source-snapshots table). When a fresh AA fetch fails in publish mode, enrichment runs from the last
  persisted snapshot; claims keep the snapshot's original `observed_at`. A feed notice is emitted when
  the snapshot in use is older than 7 days.
- **CON-004**: In DB-less mode (`npm run collect` without `--publish`), there is no persisted snapshot:
  a failed AA fetch yields null scores plus a notice for that run. This asymmetry is accepted.

### Attribution

- **REQ-016**: The feed document gains a top-level `attributions` array naming Artificial Analysis
  (`https://artificialanalysis.ai/`), Design Arena, and models.dev, with a human-readable notice each.
- **REQ-017**: The explorer model-detail drawer shows a "Scores by Artificial Analysis" credit (with
  link and observed-at age) wherever scores render; the docs page gains a data-sources/attribution
  section.

### Ranking & profiles

- **REQ-018**: The default "Recommended" sort becomes quality-first: availability desc →
  `reasoning_score` desc (nulls last) → `coding_score` desc (nulls last) → blended price asc →
  context desc → id. Implemented in `src/feed/ranking.ts` and consumed by the explorer (no UI
  re-implementation).
- **REQ-019**: New feed profiles: `best-coder` (max `coding_score`, requires `tool_use`),
  `best-agentic` (max `agentic_score`, requires `tool_use` + `structured_output`), `fastest-coder`
  (max `speed_score` among offerings with `coding_score` ≥ 40), `best-value-coder` (max
  `coding_score` ÷ blended USD/1M among paid offerings with both prices known). `best-free-coder`
  gains score-awareness (score desc inserted before context in its chain).
- **CON-005**: Blended price = `0.75 × input_usd_per_1m_tokens + 0.25 × output_usd_per_1m_tokens`
  (input-weighted: agentic coding workloads are context-heavy). Recorded as an ADR; used by
  `best-value-coder` and as the REQ-018 price tiebreak (free/zero-priced sorts as 0).
- **CON-006**: `fastest-coder`'s floor (`coding_score` ≥ 40) is an ADR-recorded constant.
- **REQ-020**: Profiles are addressable via the existing profile mechanism (API `profile=` filter and
  CLI), and each is exposed as an export preset.

### UI & exports

- **REQ-021**: Explorer table gains score columns (Coding, Reasoning, Speed) rendering "—" for null;
  sort options for coding/reasoning/speed (nulls always last); detail drawer shows the full quality
  object with per-score source and age.
- **REQ-022**: A "delegation table" Markdown export preset renders the current (filtered) selection as
  a table: model id, provider, coding/reasoning/agentic/speed scores, context, blended price — the
  shape a CLAUDE.md delegation section wants.

### Decision records

- **REQ-023**: Four ADRs in `docs/adr/`: verbatim score scale (0002, plan 026), canonical namespace
  choice (0003, plan 027), propagation rules incl. intrinsic/endpoint split (0004, plan 031), ranking
  policy incl. blend formula and floor (0005, plan 032).

### Guidelines

- **GUD-001**: Follow the existing collector patterns (`fetchJson`, `claim()`, notices,
  `collectorNotice`) for all new fetchers/enrichers.
- **GUD-002**: Enrichment runs as pipeline stages after collectors, before merge/publish, in
  `src/enrichers/` (canonicalize → models.dev → AA → propagate). Pure functions; fetches injected via
  `CollectorContext`.
- **PAT-001**: Regression/unit tests use captured live payload excerpts as fixtures, per
  `src/collectors/groq.test.ts`.

## 4. Interfaces & Data Contracts

### quality object (per offering)

```jsonc
// Illustrates the shape only (matches the hand-built fixture specimen in
// src/feed/fixture.ts, used for downstream testing) — NOT what live collected
// data shows. Per the confirmed limitation in section 7a, speed_score and
// benchmarks.ttft_seconds are null on every offering in real collected data
// today; no integrated source exposes per-endpoint speed.
"quality": {
  "coding_score": 71.4,          // AA coding_index, 0–100, verbatim; null if unscored
  "reasoning_score": 51.2,       // AA intelligence_index, 0–100
  "agentic_score": 45.6,         // AA agentic_index, 0–100
  "speed_score": 245.0,          // AA median output tokens/sec for THIS provider's endpoint; never propagated
  "benchmarks": {                // null when no detail available
    "math_score": 62.1,
    "ttft_seconds": 0.31,        // endpoint-matched only
    "artificial_analysis": { "mmlu_pro": 0.78, "gpqa": 0.61, "livecodebench": 0.55 },
    "design_arena": [ { "arena": "overall", "elo": 1123, "rank": 14, "win_rate": 0.52 } ]
  },
  "recommendation_notes": []
}
```

### canonical_model (per offering)

```jsonc
"canonical_model": {
  "id": "meta-llama/llama-3.3-70b-instruct",  // OpenRouter slug namespace
  "confidence": "high",                        // "high" = alias/exact match; "medium" = provider echo
  "knowledge_cutoff": "2024-12-01",            // models.dev; null unknown
  "release_date": "2025-01-15",                // models.dev; null unknown
  "open_weights": true                         // models.dev; null unknown
}
```

### Feed-level attribution

```jsonc
"attributions": [
  { "source": "Artificial Analysis", "url": "https://artificialanalysis.ai/",
    "notice": "Model quality and performance scores by Artificial Analysis." },
  { "source": "models.dev", "url": "https://models.dev/", "notice": "Model metadata from models.dev (MIT)." },
  { "source": "Design Arena", "url": "https://designarena.ai/", "notice": "Design Arena Elo ratings." }
]
```

### Alias table (`src/feed/canonical-aliases.ts`)

```ts
export const CANONICAL_ALIASES: Record<string, string> = {
  "groq:llama-3.3-70b-versatile": "meta-llama/llama-3.3-70b-instruct",
  "gemini:gemini-2.5-pro": "google/gemini-2.5-pro",
  "github-models:openai/gpt-4.1-mini": "openai/gpt-4.1-mini"
  // exhaustive for current catalog; unmatched offerings keep provider echo at confidence "medium"
};
```

### External endpoints

| Source | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| OpenRouter embed | `GET https://openrouter.ai/api/v1/models` (`data[].benchmarks`) | existing `OPENROUTER_API_KEY` | already fetched |
| AA direct | `GET https://artificialanalysis.ai/api/v2/data/llms/models` | `x-api-key: ARTIFICIALANALYSIS_API_KEY` | 1,000 req/day free; 1 call/run |
| models.dev | `GET https://models.dev/api.json` | none | ~3.1 MB; provider→model keyed |

## 5. Acceptance Criteria

- **AC-001**: Given the live OpenRouter payload, when collectors run, then every `openrouter:*`
  offering carrying `benchmarks.artificial_analysis` has non-null `coding_score`/`reasoning_score`/
  `agentic_score` equal to the payload values, each with a `third_party_catalog` claim.
- **AC-002**: Given `groq:llama-3.3-70b-versatile` alias-mapped to a scored canonical model, when the
  pipeline runs, then the Groq offering carries the same intrinsic scores at confidence `"medium"`
  with a join-recording claim, and its `speed_score` is null — per section 7a's confirmed limitation,
  no integrated source exposes per-endpoint speed today, so this field is null build-wide and must
  never be filled by copying another provider's speed.
- **AC-003**: Given an offering whose provider API reports no `tool_use` but models.dev says
  `tool_call: true`, when enrichment runs, then `tool_use` is added ONLY if the provider field was
  absent/empty for that capability dimension, and never removed.
- **AC-004**: Given the AA fetch fails in publish mode with a 5-day-old persisted snapshot, when the
  pipeline runs, then scores are published from the snapshot with original `observed_at` and no
  staleness notice; given the snapshot is 8 days old, a staleness notice is present.
- **AC-005**: Given the published feed, then `attributions` names AA, models.dev, and Design Arena;
  and the explorer detail drawer shows the AA credit next to scores.
- **AC-006**: Given profile `best-value-coder`, then every returned offering has `pricing.kind: "paid"`,
  non-null input+output prices, non-null `coding_score`, ordered by `coding_score / (0.75·in + 0.25·out)`.
- **AC-007**: Given two offerings where A is available with `reasoning_score` 60 and B available with
  null scores, then A sorts before B under Recommended; unscored never outranks scored at equal
  availability.
- **AC-008**: The delegation-table export renders exactly the filtered set with the REQ-022 columns
  in valid GitHub-flavored Markdown.

## 6. Test Automation Strategy

- **Test Levels**: unit (schema, aliases, propagation, ranking, profiles, exports) and integration
  (pipeline over captured fixtures) via **vitest** (`environment: node`), matching the existing suite.
- **Fixtures**: captured excerpts of the OpenRouter embed, AA response, and models.dev payload checked
  in as test fixtures; `exampleFeed` extended with scored specimens.
- **Test Data Management**: fixtures are static files; no network in tests (fake `fetch` via
  `CollectorContext`, per `groq.test.ts`).
- **CI/CD Integration**: existing `npm test` in CI; the refresh workflow gains the AA env var.
- **Coverage Requirements**: every REQ with observable behavior has at least one test; no numeric
  threshold mandated.
- **Performance Testing**: none (payloads ≤ ~3.5 MB, daily batch).

## 7. Rationale & Context

- **Verbatim units** (CON-001): consumers build delegation rules against these numbers; a number
  traceable to its source survives audits and re-derivation. Normalized speed percentiles would shift
  with catalog composition.
- **OpenRouter slug namespace** (REQ-012): broadest catalog we already fetch, creator-qualified,
  and 3 of 4 providers' models mostly exist there. Avoids owning a naming authority.
- **Intrinsic/endpoint split** (REQ-013): the same weights run ~10× faster on Groq than a typical
  route; propagating speed would sabotage speed-based delegation, the feature's core purpose.
- **Provider-wins precedence** (CON-003): first-party data is contractual; community data fills gaps.
- **Carry-forward** (REQ-015): one 03:17 fetch failure must not strip quality data from the public
  feed for a day; visible age keeps it honest.
- **Quality-first default** (REQ-018): the explorer should answer "what's the best model?"; free
  discovery remains one toggle away. Accepted consequence: unscored specialty models sink.
- **Input-weighted blend** (CON-005): agentic coding traffic is dominated by prompt/context tokens.

## 7a. Confirmed limitation (recorded post-hoc, plan 029)

Artificial Analysis's `/api/v2/data/llms/models` endpoint returns model-level speed medians only —
no per-provider-host dimension exists in the payload (verified live 2026-07-11: no host/provider
field anywhere; guessed per-model detail endpoints 404). REQ-013's endpoint-matched speed sourcing
therefore has no data to draw on: `speed_score` and `benchmarks.ttft_seconds` stay null across the
entire build. This is accepted, not a defect — REQ-013's "never propagate" rule correctly prevents
attaching an ambiguous model-level number to any one provider's offering. Direct consequence: the
`fastest-coder` profile (REQ-019) will always return an empty set until a genuinely per-endpoint
speed source is integrated (out of scope here). Revisit if/when that matters.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: OpenRouter API — existing collector; source of embedded AA/Design Arena data.
- **EXT-002**: Artificial Analysis API v2 — score origin; free tier, attribution mandatory.
- **EXT-003**: models.dev — static JSON catalog, MIT, no auth.

### Infrastructure Dependencies
- **INF-001**: GitHub Actions secret `ARTIFICIALANALYSIS_API_KEY` (exists) wired into the refresh workflow.
- **INF-002**: Postgres (existing) for source snapshots enabling carry-forward.

### Data Dependencies
- **DAT-001**: AA response cached per run; last-good snapshot persisted (REQ-015).

### Compliance Dependencies
- **COM-001**: AA free-tier attribution requirement → REQ-016/REQ-017.
- **COM-002**: models.dev MIT license — attribution included as courtesy and clarity.

## 9. Examples & Edge Cases

```text
Propagation example (confirmed live shape, per section 7a — no integrated source exposes
per-endpoint speed today, so speed stays null everywhere, including on the direct donor):
  openrouter:meta-llama/llama-3.3-70b-instruct  coding 39.8 (direct, high) + speed null
  groq:llama-3.3-70b-versatile                  coding 39.8 (propagated, medium) + speed null
  github-models:meta/llama-3.3-70b-instruct     coding 39.8 (propagated, medium) + speed null

Edge cases:
- Model AA scores by name-match but with no OpenRouter representation (confidence stays "medium" —
  no alias entry, so no propagation donor either): stays unscored. AA-direct enrichment attaches
  claims only to `openrouter:*` offerings (see plan 031/ADR 0004) — non-OpenRouter offerings receive
  intrinsic scores solely through propagation from a high-confidence canonical twin. This is a
  known, bounded gap: confirmed live 2026-07-11 on 6 of 453 offerings (GitHub Models' o1-mini,
  o1-preview, mistral-medium-2505, mistral-small-2503, phi-4-mini-instruct,
  phi-4-multimodal-instruct), all lacking an OpenRouter alias today. Closing it would require the AA
  enricher to know which offerings propagation will later cover — a cross-stage dependency judged not
  worth the complexity for 6 offerings; revisit if the gap grows materially.
- Free model in best-value-coder: excluded (kind must be "paid"); free models belong to best-free-coder.
- fastest-coder with no offering meeting the coding floor: profile returns empty, not a lowered floor.
- Two OpenRouter variants (`:free` suffix) of one model: both map to the same canonical slug; the
  alias table strips the variant suffix for canonical purposes only.
- AA sub-benchmark set changes shape: unknown keys are stored verbatim in the map (REQ-005) — no
  schema break; removed keys simply vanish next run.
- Offering with scores but pricing unknown: appears in best-coder/best-agentic (price-agnostic),
  excluded from best-value-coder; Recommended price-tiebreak treats unknown as +∞ (last).
```

## 10. Validation Criteria

- `npm test` passes; new tests cover AC-001…AC-008.
- `npm run collect` (with keys) produces a feed where ≥100 offerings carry non-null coding/reasoning
  scores and every score-bearing offering has a matching claim.
- `npm run validate:fixture` passes against the extended schema.
- Published JSON Schema (`src/feed/json-schema.ts`) describes all new fields with units.
- Manual: explorer shows score columns/sorts, drawer credits AA, docs page lists sources; four ADRs merged.

## 11. Related Specifications / Further Reading

- `docs/research/model-quality-sources.md` — source evaluation and licensing evidence.
- `docs/adr/0001-feed-publication-state-machine.md` — ADR conventions; this spec adds 0002–0005.
- `plans/README.md` — execution tickets 026+ derived from this spec.
- [Artificial Analysis API documentation](https://artificialanalysis.ai/documentation)
- [models.dev repository](https://github.com/sst/models.dev)
