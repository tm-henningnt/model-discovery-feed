# Model Discovery Feed

This repository defines a provider-agnostic, JSON-over-HTTP feed for discovering LLM offerings. The feed is for clients that need to find usable models now, especially free or free-tier options, without hardcoding provider catalogs.

## Contract

The feed document is versioned with `schema_version: "1.0.0"`.

The current contract is centered on four object types:

- `provider`: a runtime or vendor a client can call.
- `model_offering`: a provider-specific way to call a model.
- `profile`: a feed-authored recommendation over one or more offerings.
- `source_claim`: provenance for facts pulled from provider APIs, docs, pricing pages, catalog pages, health checks, or manual overrides.

Key invariants:

- Clients must ignore unknown fields.
- `model_offering.pricing.kind = "free"` must include `pricing.free` metadata.
- Facts and opinions are separate. Source claims describe observations; quality and recommendation fields are feed-owner judgments.
- `free` is not a boolean. The feed records why an offering is free, when that was last verified, and whether the claim expires.
- `model_offering.quality` scores are stored verbatim in their source's own units (0-100 indexes, tokens/sec, seconds) — never normalized or rescaled by the feed. A `null` score means unscored, not zero.
- `attributions` names every third-party data source the feed republishes (e.g. Artificial Analysis, models.dev, Design Arena). Clients that surface `quality` data should carry that attribution forward.

Important fields:

- `feed.generated_at`, `feed.expires_at`, `feed.source_revision`, `feed.default_stale_after_seconds`
- `attributions`: third-party data source credits (`source`, `url`, `notice`)
- `provider.api_protocols`, `provider.authentication`, `provider.signup`
- `model_offering.provider_model_id`, `model_offering.canonical_model`
- `model_offering.canonical_model.knowledge_cutoff`, `.release_date`, `.open_weights`: model-level metadata gap-filled from models.dev when a provider's own API doesn't supply it
- `model_offering.endpoint.protocol`, `model_offering.endpoint.base_url`, `model_offering.endpoint.model`
- `model_offering.endpoint.protocol_options.response_envelope_key`: optional top-level response key to unwrap before parsing as OpenAI chat completion format (describes response shape, not request shape)
- `model_offering.capabilities`
- `model_offering.limits.context_tokens`, `model_offering.limits.max_output_tokens`
- `model_offering.pricing.kind`, `model_offering.pricing.free`
- `model_offering.availability.status`
- `model_offering.quality.coding_score`, `.reasoning_score`, `.agentic_score`, `.speed_score`: third-party benchmark scores, verbatim units, `null` when unscored
- `model_offering.quality.benchmarks`: sub-benchmark detail (math score, time-to-first-token, per-benchmark scores, Design Arena Elo)
- `model_offering.policy.visibility`, `model_offering.policy.tags`

### Free classification

`pricing.kind` uses these values:

- `free`
- `free_tier`
- `trial`
- `subscription_included`
- `paid`
- `local`
- `unknown`

When `pricing.kind = "free"`, `pricing.free` records:

- `is_currently_free`
- `basis`
- `requires_account`
- `requires_api_key`
- `requires_credit_card`
- `quota`
- `expires_at`
- `last_verified_at`
- `confidence`

### Billing unit

`pricing.metering` names the unit the provider bills in. The rate fields
`input_usd_per_1m_tokens` and `output_usd_per_1m_tokens` are meaningful only when it is `tokens`:

- `tokens` — per-token billing; the rate fields carry USD per 1M tokens.
- `credits` — a subscription's own quota unit. Read `pricing.subscription` for the plan facts.
- `images`, `video_seconds`, `characters`, `audio_seconds` — the provider bills per generated image, per
  second of output video, per character of input text, or per second of input audio.

An offering can state `pricing.kind = "paid"` with both rate fields `null`. That combination means the
price is known to exist but is not expressed in tokens; use `metering` to see which unit applies.

### Quality scores

`quality` carries third-party benchmark scores for an offering, when available. Every field is stored
verbatim in its source's own units — no normalization, no rescaling:

- `coding_score`, `reasoning_score`, `agentic_score`: 0-100 indexes.
- `speed_score`: median output tokens/sec, when a source measures it per provider endpoint. As of this
  writing no integrated source exposes per-endpoint speed, so this field is `null` feed-wide.
- `benchmarks`: sub-benchmark detail (`math_score`, `ttft_seconds`, per-benchmark scores under
  `artificial_analysis`, and `design_arena` Elo ratings), or `null` when no detail is available.

A `null` quality field means unscored, not a zero or a negative judgment. `attributions` names
the sources these scores come from; carry that attribution forward wherever you surface them.

### Delegation profiles

A profile is one feed-authored recommendation: for a stated job, the single offering the feed picks.
The feed regenerates every profile on each collector run from that run's own offerings.

The feed publishes four:

- `best-free-coder` — the best coder that costs nothing. Prefers a genuinely free offering over a
  subscription one, then ranks on `coding_score`.
- `best-coder` — the highest `coding_score` at any price, among offerings that support `tool_use`.
- `best-agentic` — the highest `agentic_score`, among offerings that support `tool_use` and
  `structured_output`.
- `best-value-coder` — the highest `coding_score` per blended dollar, among paid offerings with
  known prices.

Each profile carries `selection.model_offering_id`, `selection.selected_at`, and
`selection.expires_at`. `selected_at` is the run that made the pick. `expires_at` is that run plus
`feed.default_stale_after_seconds`. Re-read the feed rather than trusting an expired pick.

`criteria` records what the profile required and what it ordered by. Read it if you need to know why
an offering won.

Two rules to code against:

- A profile is **absent** from the array when no offering qualifies. The feed never emits a profile
  with an empty or null selection, and never lowers its bar to fill one. Handle a missing id.
- A profile never selects an offering whose `policy.visibility` is not `listed`, so a retired or
  hidden offering is never recommended.

`GET /v1/models?profile=<id>` applies the same predicate and ordering live against the current feed.
Use the published array for a stable pick, and the query for a pick against your own filters.

### Availability

`availability.status` answers one question: does the provider's own catalog currently list this
offering for sale? It is never a guarantee that your account can call the model. The feed observes
availability with the feed's own collector credentials. A provider can gate a model by account age,
region, or plan tier. The feed cannot detect that gating. Treat `available` as "worth trying", not
as "confirmed to work for you".

The values mean:

- `available` — the provider's catalog lists the offering now.
- `limited` — the provider lists the offering with a restriction (for example, a waitlist or reduced
  rate limit).
- `deprecated` — the offering still answers calls, but it is scheduled to go away. The feed sets
  this status from a provider-published retirement date in the future, or from a third-party
  deprecation record when no first-party date exists. A source claim on the offering names which
  rule fired.
- `retired` — the offering left the provider's catalog, or its provider-published retirement date
  has already passed. The feed hides a retired offering from search, facets, and profile ranking at
  once. A client that already pinned this offering's id can still fetch it by id. The feed removes
  the offering completely 7 days after `last_success_at`.
- `blocked` — the feed owner blocked the offering by policy.
- `unknown` — the offering was absent from one collector run. The feed has not confirmed it is gone.

Use `last_success_at`, not `last_checked_at`, to judge freshness. `last_checked_at` advances on every
collector run, even a run where the provider's collector failed to fetch anything. `last_success_at`
advances only when the collector observed the offering in that run. A gap between the two fields
means the row carried forward from an earlier run without a new observation — check `last_success_at`
before you trust `available`.

## Endpoints

The implementation defines these public endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/feed` | Return the latest feed snapshot. Use conditional requests with `ETag` and `If-None-Match` when possible. |
| `GET /v1/status` | Return service and freshness status. |
| `GET /v1/schema` | Return the JSON Schema for the contract. |
| `GET /v1/models` | Return model offerings, with additive filtering. |
| `GET /v1/models/{id}` | Return one model offering by id. |
| `GET /v1/providers` | Return providers, with additive filtering. |

Filtering is intentionally client-friendly and additive. The implementation supports provider, capability, pricing kind, protocol, context window, API-key requirement, and availability as supported filter dimensions. Clients should tolerate unknown filters and unknown response fields.

## Reference CLI

The repo exposes a `model-feed` CLI entrypoint in `package.json`.

Typical usage:

```bash
npm run model-feed -- --help
npm run model-feed -- list --feed https://example.com/v1/feed --capability coding --json
npm run model-feed -- list --feed https://example.com/v1/feed --api-key "$MODEL_FEED_API_KEY" --etag '"abc123"' --cache .cache/model-feed.json
```

The reference CLI is meant to:

- fetch a feed;
- validate `schema_version`;
- send `Authorization: Bearer ...` when an API key is supplied;
- send `If-None-Match` when an ETag is supplied or restored from cache;
- cache with `ETag` when available;
- filter to coding-capable offerings;
- sort by the feed's default free-coder criteria;
- emit JSON that adapter authors can transform locally.

The CLI also reads `MODEL_FEED_API_KEY` as an alternative to `--api-key`.
Use `--cache` when you want a 304 response to reuse previously fetched feed data; `--etag` alone can still receive 304, but it cannot render rows without a cached feed snapshot.

## Adapter boundaries

The feed is discovery infrastructure, not a client profile format.

Do:

- read feed offerings;
- map them into your own profiles, menus, aliases, or commands;
- preserve provenance when you surface a recommendation;
- ignore fields you do not understand.

Do not:

- require the feed to know your config schema;
- depend on client-specific names or files;
- treat feed opinions as mandatory client policy;
- put client-specific settings into the public contract.

## Conformance fixtures

Fixtures in `docs/public/fixtures/` are for client and adapter tests.

They are not live provider data. The adapter output fixture is non-normative and intentionally not a client profile format.

## Non-normative Client Examples

These examples show the shape of a local adapter. They are not part of the feed contract.

### Example 1: turn a free coding offering into a local profile

```json
{
  "profile_name": "free-coding-default",
  "source_model_offering_id": "openrouter:qwen/qwen3-coder:free",
  "provider": "OpenRouter",
  "model": "qwen/qwen3-coder:free",
  "capabilities": ["chat", "coding", "tool_use", "structured_output"],
  "notes": "Mapped from a feed offering with verified free pricing."
}
```

### Example 2: keep feed data and client config separate

```json
{
  "feed_snapshot": {
    "model_offering_id": "groq:openai/gpt-oss-120b",
    "pricing_kind": "unknown",
    "availability": "available"
  },
  "client_profile": {
    "name": "groq-oss-120b",
    "selected_model": "groq:openai/gpt-oss-120b",
    "temperature": 0.2
  }
}
```

The feed only supplies the first block. The second block belongs to the client.
