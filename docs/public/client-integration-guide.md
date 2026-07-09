# Client Integration Guide for the Model Discovery Feed

Last updated: 2026-07-09

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
  providers: Provider[];
  models: ModelOffering[];
  profiles: FeedProfile[];
  notices: Array<Record<string, unknown>>;
};
```

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
