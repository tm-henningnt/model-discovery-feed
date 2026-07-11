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
