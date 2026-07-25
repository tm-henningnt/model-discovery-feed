# Client Integration Guide for the Model Discovery Feed

Last updated: 2026-07-25

This document gives client, editor, and automation tool authors the information needed to build an adapter around the Model Discovery Feed API.

The feed is a provider-agnostic JSON API for discovering LLM model offerings. It is designed for clients that need to find usable models, especially free or free-tier options, without hardcoding provider catalogs.

## 1. API Base

Use your deployment's base URL. Examples in this guide use:

```text
<feed-base-url>
```

Current feed URL example:

```text
https://example.com/v1/feed
```

Authoritative JSON Schema URL example:

```text
https://example.com/v1/schema
```

The current contract version is:

```json
{
  "schema_version": "1.0.0"
}
```

## 2. Authentication

Most data endpoints require bearer authentication in production.

Use:

```http
Authorization: Bearer <MODEL_FEED_API_KEY>
```

Example:

```bash
curl \
  -H "Authorization: Bearer $MODEL_FEED_API_KEY" \
  <feed-base-url>/v1/status
```

Authentication failures return:

```http
HTTP/2 401
WWW-Authenticate: Bearer
Content-Type: application/json; charset=utf-8
```

```json
{
  "error": "unauthorized"
}
```

Important security notes for client developers:

- The feed API key is only for reading this discovery feed. It is not a provider API key.
- Do not bundle the feed key in a public extension or repository.
- Prefer a user-provided token stored in the host application's secret store, or route feed access through your own backend if you need to distribute a managed integration.
- Provider calls still require the user's own provider credentials when the selected provider requires them.

## 3. Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/schema` | No | Returns the JSON Schema for feed documents. |
| `GET` | `/v1/status` | Yes | Returns freshness, counts, and collector health for the latest published feed. |
| `GET` | `/v1/feed` | Yes | Returns the full feed snapshot, including providers, model offerings, profiles, and notices. |
| `GET` | `/v1/models` | Yes | Returns listed model offerings, optionally filtered by query parameters. |
| `GET` | `/v1/models/{id}` | Yes | Returns one model offering by feed model id. |
| `GET` | `/v1/providers` | Yes | Returns providers, optionally filtered by query parameters. |

Model ids can contain characters such as `/`, `:`, or spaces. URL-encode ids when calling `/v1/models/{id}`.

Example:

```ts
const url = `${baseUrl}/v1/models/${encodeURIComponent(modelId)}`;
```

If a model is not found, `/v1/models/{id}` returns:

```http
HTTP/2 404
```

```json
{
  "error": "model_not_found",
  "id": "<decoded model id>"
}
```

## 4. Caching and Freshness

`GET /v1/feed` supports HTTP cache validation.

Response headers include:

```http
ETag: "<sha256-base64url>"
Last-Modified: <generated_at as HTTP date>
Cache-Control: private, max-age=300
```

Clients should store the `ETag` and send it on the next request:

```http
If-None-Match: "<previous etag>"
```

When the feed has not changed, the API returns:

```http
HTTP/2 304
```

with no response body. The client should reuse its cached feed body.

Other cache headers:

| Endpoint | Cache behavior |
| --- | --- |
| `/v1/feed` | `private, max-age=300`, `ETag`, `Last-Modified`, supports `If-None-Match`. |
| `/v1/status` | `private, max-age=60`. |
| `/v1/schema` | `public, max-age=3600`. |
| `/v1/models`, `/v1/models/{id}`, `/v1/providers` | No explicit cache contract. Prefer `/v1/feed` plus local filtering when building a cached adapter. |

The feed is published as a last-known-good release. If a collector fails, the API can still serve the latest valid published feed while `/v1/status` reports degraded collector health.

## 5. Status Response

`GET /v1/status` returns:

```ts
type FeedStatus = {
  object: "feed_status";
  feed_id: string;
  schema_version: "1.0.0";
  generated_at: string;
  expires_at: string | null;
  stale_at: string;
  source_revision: string;
  stale: boolean;
  provider_count: number;
  model_count: number;
  profile_count: number;
  collector_health: {
    status: "ok" | "degraded" | "unknown";
    message: string;
    notices: Array<Record<string, unknown>>;
  };
};
```

Recommended client behavior:

- If `stale` is `true`, show a warning but allow users to continue with cached or published data.
- If `collector_health.status` is `degraded`, inspect `collector_health.notices`; the feed can still contain valid data from successful providers.
- Do not treat degraded status as a hard failure unless your workflow requires fresh provider data.

## 6. Feed Document Schema

The authoritative machine-readable schema is available at `/v1/schema`.

Clients must:

- Require `schema_version === "1.0.0"` for this integration generation.
- Ignore unknown fields at every level.
- Treat missing or unknown values as unknown, not false.
- Validate provider/model/profile references if building a cache or local database.

Top-level feed document:

```ts
type FeedDocument = {
  schema_version: "1.0.0";
  feed: FeedMetadata;
  attributions: Array<{ source: string; url: string; notice: string }>;
  providers: Provider[];
  models: ModelOffering[];
  profiles: FeedProfile[];
  notices: Array<Record<string, unknown>>;
};
```

`attributions` names every third-party data source the feed republishes into `quality`/`canonical_model`
fields (e.g. Artificial Analysis, models.dev, Design Arena). If your client surfaces those fields to a
user, carry the matching attribution forward.

Feed metadata:

```ts
type FeedMetadata = {
  id: string;
  generated_at: string;
  expires_at: string | null;
  source_revision: string;
  default_stale_after_seconds: number;
};
```

Provider:

```ts
type Provider = {
  id: string;
  object: "provider";
  name: string;
  homepage: string | null;
  api_protocols: EndpointProtocol[];
  default_base_url: string | null;
  authentication: ProviderAuthentication | null;
  signup: ProviderSignup | null;
  source_claims: SourceClaim[];
};
```

Model offering:

```ts
type ModelEndpoint = {
  protocol: string;
  base_url: string | null;
  model: string;
  protocol_options?: {
    response_envelope_key?: string | null;
    [key: string]: unknown;
  };
};

type ModelOffering = {
  id: string;
  object: "model_offering";
  display_name: string;
  provider: { id: string; name: string };
  provider_model_id: string;
  canonical_model: CanonicalModel | null;
  description: string | null;
  endpoint: ModelEndpoint;
  capabilities: Capability[];
  limits: ModelLimits | null;
  pricing: Pricing;
  availability: Availability;
  quality: Quality | null;
  source_claims: SourceClaim[];
  policy: Policy | null;
};
```

`canonical_model` additionally carries `knowledge_cutoff`, `release_date`, and `open_weights`
(all nullable, gap-filled from models.dev when a provider's own API doesn't supply them). `quality`
carries `coding_score`, `reasoning_score`, `agentic_score`, `speed_score` (third-party benchmark
scores in their source's own units, verbatim — never normalized; `null` means unscored, not zero) and
a `benchmarks` object with sub-benchmark detail. `/v1/schema` has the full, authoritative shape of
both.

### Availability semantics

`availability.status` reports provider catalog membership, not per-account callability:

- `available` — the provider's catalog lists the offering now.
- `limited` — the provider lists the offering with a restriction (waitlist, reduced rate limit).
- `deprecated` — the offering is still callable, but it is scheduled to go away. The feed sets this
  status from a provider-published retirement date in the future, or from a third-party deprecation
  record when the provider itself publishes no date. Check the offering's source claims to see
  which rule fired.
- `retired` — the offering left the provider's catalog, or its provider-published retirement date has
  already passed. It stays fetchable at `GET /v1/models/{id}` for 7 days after `last_success_at`, but
  `GET /v1/models` and `available=true` stop returning it immediately.
- `blocked` — the feed owner blocked the offering by policy.
- `unknown` — the offering was absent from one collector run; not yet confirmed gone.

Read `last_success_at` as the freshness field, not `last_checked_at`. `last_checked_at` advances on
every collector run, even a run where the provider's collector failed. `last_success_at` advances only
when the collector actually observed the offering that run. When the two fields differ, the row
carried forward without a new observation — do not read a fresh `last_checked_at` as proof the
offering is confirmed available.

`available` never guarantees a call succeeds for your account. The feed checks availability with its
own collector credentials. A provider can gate a model by account age, region, or plan tier that the
feed's credentials do not have. Handle a rejected call from a provider even when the feed says
`available`.

### Delegation profiles

`profiles[]` holds the feed's own recommendations, regenerated on every collector run. Four ids
exist: `best-free-coder`, `best-coder`, `best-agentic`, and `best-value-coder`.

```ts
type FeedProfile = {
  id: string;
  object: "profile";
  display_name: string;
  description: string | null;
  selection: {
    model_offering_id: string;
    selected_at: string;
    expires_at: string | null;
  };
  criteria: Record<string, unknown>;
};
```

Read a profile like this:

1. Find the id you want. **Handle its absence.** A profile is omitted entirely when no offering
   qualifies. The feed never emits an empty selection and never lowers its bar to fill one.
2. Resolve `selection.model_offering_id` against `models`. It always resolves, and it always points
   at an offering whose `policy.visibility` is `listed`.
3. Check `selection.expires_at` before you act on a cached feed. Re-read the feed when it has passed.

Call `GET /v1/models?profile=<id>` to apply the same predicate and ordering live. Use the published
array when you want the same pick the feed published; use the query when you want a pick that
respects your own filters.

`fastest-coder` was removed. No provider the feed integrates publishes a per-endpoint speed
measurement, so the profile could never return a result. Requests for it no longer resolve.

### Capabilities state kind, not degree

A capability says what kind of work an offering supports. It never says how well the offering does
that work. `coding` means the offering supports code generation. It does not mean the offering is
good at it.

Rank by score, filter by capability. To find the best coder, filter on the `coding` capability, then
sort on `quality.coding_score` descending. Do not treat the capability as a quality signal, and do
not treat a missing capability as proof the model cannot do the work.

The feed derives `coding` from positive evidence: a benchmark coding score, or a coding keyword in
the offering's id, display name, or description. An offering with neither stays unflagged, because
the feed does not claim what it cannot source. A source claim on each flagged offering names the
rule that fired.

`quality.coding_score` is `null` for an unscored offering. `null` means unmeasured, not zero. Sort
unscored offerings last rather than treating them as the worst.

### Response shape handling

`endpoint.protocol` describes the request shape, not the response shape. Some providers wrap their response under a top-level key. Use `response_envelope_key` to unwrap it.

When `response_envelope_key` is present:

1. Read the value at that key from the HTTP response body.
2. Parse the unwrapped value as an OpenAI chat completion object.

Example: Cline wraps responses under `data`. Success has shape:

```json
{
  "data": {
    "choices": [...],
    "model": "...",
    "usage": {...}
  },
  "success": true
}
```

Unwrap to: `{ "choices": [...], "model": "...", "usage": {...} }` before parsing as OpenAI.

An error response does not use the envelope key. It is not an OpenAI error object either:

```json
{
  "error": "model not found",
  "success": false
}
```

The `error` value is a plain string. It is not an object with `message` and `code`. Check `success` before you unwrap. When `success` is `false`, read `error` as a string.

## 7. Adapter Boundary

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

## 8. Conformance Fixtures

Fixtures in `docs/public/fixtures/` are for client and adapter tests.

They are not live provider data. The adapter output fixture is non-normative and intentionally not a client profile format.

## 9. Example Client Adapter Flow

1. Read the feed URL from configuration, defaulting to `https://example.com/v1/feed`.
2. Fetch `/v1/feed` with bearer authentication when required.
3. Store the response `ETag` and reuse it with `If-None-Match`.
4. Validate `schema_version` before using the payload.
5. Filter or rank offerings using your local rules.
6. Map selected `ModelOffering` records into your own provider/model options.
7. Keep feed data and client config separate.

### Example: turn a free coding offering into a local profile

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

### Example: keep feed data and client config separate

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
