# Adding ClinePass as a model-discovery source

> Research note, 2026-07-13. Question: ClinePass (Cline's flat-rate model bundle) has no advertised public
> models API — only a docs page. Should our collector scrape that page, or ship a hand-maintained static
> file? All endpoint/HTML claims below were verified by live `curl` on 2026-07-12/13.

## Verdict

**Neither scrape the HTML nor hand-maintain a static roster.** Cline exposes a **public, unauthenticated
first-party JSON endpoint** that backs the ClinePass model picker in the app:
`https://api.cline.bot/api/v1/ai/cline/recommended-models` (returns a `clinePass[]` array). Use it as the
authoritative model list. It omits pricing/context/capabilities, so pair it with the docs page's
**per-page Markdown variant** (`https://docs.cline.bot/getting-started/clinepass.md`) — a clean,
stable Markdown table — for reference pricing, and derive context/capabilities the same way Cline's own
app does: a slug join to our existing OpenRouter data. HTML scraping is unnecessary (the model data is a
first-party JSON call away) and a checked-in static file would go stale (the roster changed as recently
as 2026-06-29).

## 1. What the `#models` section actually contains

The page is a **Mintlify docs site (Next.js SSR)**. `curl` of the rendered page
(`https://docs.cline.bot/getting-started/clinepass`, HTTP 200, ~357 KB) returns a **real static
server-rendered `<table>`** in the `#models` section — the model data is present in the server HTML, not
purely client-rendered:

```html
...el ID</th></tr></thead><tbody><tr><td>GLM-5.2</td><td><code>cline-pass/glm-5.2</code></td></tr>
<tr><td>Kimi K2.7 Code</td><td><code>cline-pass/kimi-k2.7-code</code></td></tr>...
```

(The same rows also appear a second time inside an escaped Next.js `_jsx(...)` hydration payload in a
`<script>` block.) So the list is technically scrapable from static markup — a `table` with a
`<code>cline-pass/...</code>` cell. But the page is a heavy 357 KB app shell wrapped around a two-column
table, and there is a far cleaner first-party source (below), so scraping the rendered HTML is the
worst of the available options.

- Source: `https://docs.cline.bot/getting-started/clinepass` (rendered HTML, fetched 2026-07-12).

## 2. Underlying JSON / structured data endpoints

Three structured sources exist; the first is the one to use.

### a. First-party JSON endpoint — PUBLIC, no auth (recommended)

`https://api.cline.bot/api/v1/ai/cline/recommended-models` — HTTP 200, `application/json`, **no
Authorization header required**. This is the exact endpoint the Cline app calls to populate the picker:
`sdk/packages/llms/src/catalog/catalog-cline-recommended.ts` in `cline/cline` builds the URL as
`${apiBaseUrl}/api/v1/ai/cline/recommended-models` and parses `{ recommended, free, clinePass }`
(function `fetchClineRecommendedModelsPayload`). Live payload (fetched 2026-07-12) has a `clinePass`
array of 10 entries:

```json
{"id":"cline-pass/glm-5.2","name":"cline-pass/glm-5.2","description":"Best open weights model","tags":[]}
{"id":"cline-pass/deepseek-v4-pro","name":"cline-pass/deepseek-v4-pro","description":"Frontier reasoning and coding with 1M context window","tags":[]}
... (kimi-k2.7-code, kimi-k2.6, mimo-v2.5-pro, mimo-v2.5, minimax-m3, qwen3.7-max, qwen3.7-plus)
```

These 10 IDs match the docs `#models` table exactly. Fields per entry: `id`, `name`, `description`,
`tags[]`. **No pricing, no context window, no capabilities.** (The payload also has `recommended[]` and
`free[]` arrays for the non-ClinePass Cline provider — ignore those for a ClinePass collector.)

- Source: `https://api.cline.bot/api/v1/ai/cline/recommended-models` (fetched 2026-07-12).
- Source: `cline/cline` → `sdk/packages/llms/src/catalog/catalog-cline-recommended.ts` (fetched via GitHub API 2026-07-12).

### b. Docs page Markdown variant — clean, carries pricing

Appending `.md` to the page path works (Mintlify feature):
`https://docs.cline.bot/getting-started/clinepass.md` — HTTP 200, `text/markdown`, ~6.3 KB. It is the
raw MDX minus components: a `## Models` table (`| Model | Model ID |`) and, crucially, a
`## Reference pricing` table with **Input / Output / Cached Read / Cached Write** per-1M rates that the
JSON endpoint lacks. Trivial to parse (GitHub-flavoured Markdown tables). `llms-full.txt`
(`https://docs.cline.bot/llms-full.txt`, 200, ~638 KB) also contains the whole page but is the entire
docs corpus concatenated — do not use it when the per-page `.md` exists. `llms.txt` (200, ~18 KB) is
just a link index, no model data.

- Source: `https://docs.cline.bot/getting-started/clinepass.md` (fetched 2026-07-12).

### c. Authenticated OpenAI-compatible `/models` — exists but gated

`https://api.cline.bot/api/v1/models` returns **HTTP 401** (`{"error":"Unauthorized: Please make sure
you're using the latest version of Cline and re-authenticate..."}`). This is the OpenAI-compatible
Chat Completions models list; it needs a Cline API key, so it is not usable for an unauthenticated
collector. The public `recommended-models` endpoint (a) is the right one anyway.

- Source: `https://api.cline.bot/api/v1/models` (fetched 2026-07-12, HTTP 401).

### d. What the open-source repo checks in

`cline/cline` does **not** hard-code a ClinePass roster or a pricing table. The docs source lives at
`docs/getting-started/clinepass.mdx`, and the runtime code (catalog-cline-recommended.ts) fetches the
list from endpoint (a) at run time. Notably, that code shows **Cline itself does not know ClinePass
context/capabilities**: `findORModelCapabilities` strips the `cline-pass/` prefix and looks the bare
slug (e.g. `glm-5.2`) up **in the OpenRouter model map**; if not found it falls back to
`CLINE_PASS_MODEL_DEFAULTS = { contextWindow: 128_000, maxInputTokens: 128_000, maxTokens: 8_192,
capabilities: ["tools","reasoning","temperature"], pricing: {input:0,output:0,cacheRead:0,cacheWrite:0} }`.
Pricing is set to 0 in-app because it's a flat subscription.

- Source: `cline/cline` → `sdk/packages/llms/src/catalog/catalog-cline-recommended.ts` (fetched 2026-07-12).

## 3. Fields exposed (what a collector can populate vs. null)

| Field (our ModelOffering)     | JSON endpoint (a) | Docs `.md` (b) | Notes |
|-------------------------------|-------------------|----------------|-------|
| `provider_model_id`           | ✅ `id` (`cline-pass/glm-5.2`) | ✅ Model ID cell | identical between the two |
| `display_name`                | ⚠️ `name` == the slug | ✅ human name (`GLM-5.2`, `Kimi K2.7 Code`) | **docs table has the pretty name; the endpoint's `name` is just the slug** |
| `description`                 | ✅ short blurb + `tags[]` | ✗ | endpoint only |
| pricing `input`/`output`      | ✗ | ✅ per-1M USD | docs only |
| pricing `cached` (read/write) | ✗ | ✅ Cached Read + Cached Write | docs only; Qwen3.7 Plus is tiered (≤256K vs >256K) and is the only one with cache-write ≠ `-` besides Qwen Max |
| `context_tokens`              | ✗ | ✗ (only hinted in prose descriptions, e.g. "1M context window") | **not published anywhere structured** |
| `max_output_tokens`          | ✗ | ✗ | not published |
| `capabilities`                | ✗ | ✗ | not published |

The reference-pricing note on the docs page states the ClinePass subscription does **not** actually
bill these per-token rates ("flat monthly subscription, so you are not charged the individual API prices
below"); they are drain-weight reference rates. Decide whether our `pricing` should carry them (useful
signal, matches how our CLAUDE.md already treats them) or be `$0`/flagged as a flat-rate bundle.

Context window, max output, and capabilities are **not obtainable from any ClinePass source** — mirror
Cline's own approach: join the bare slug to our existing OpenRouter offerings (we already ingest
OpenRouter; the slugs `glm-5.2`, `deepseek-v4-pro`, `kimi-k2.7-code`, etc. resolve there), and fall
back to Cline's documented defaults (128K ctx / 8192 out / tools+reasoning+temperature) when a slug has
no OpenRouter match.

## 4. Stability / versioning / cadence

- **Docs page is hand-edited and git-versioned.** Source is `docs/getting-started/clinepass.mdx` in
  `cline/cline`; the most recent commit touching it is **2026-06-29** ("docs: document ClinePass API
  usage (#11980)", whose body notes it *"add MiniMax M3, Qwen3.7 Max, Qwen3.7 Plus models to ClinePass
  page"*). So the roster genuinely changes over time and is maintained by hand — a checked-in static
  file in our repo would silently drift. The `.md`/HTML carry a `last-modified` header
  (`must-revalidate`), so freshness is observable.
- **JSON endpoint has no `etag`/`last-modified`/`cache-control`** in its response headers — it's a live
  application API (source of truth for the app UI), so treat every fetch as current; there's no version
  stamp to key a staleness check on beyond our own `last_verified_at`.
- Model **IDs are stable slugs** under the `cline-pass/` namespace; display names and descriptions are
  the volatile part.

## Could not determine

- Whether the `recommended-models` endpoint is rate-limited or has an uptime/SLA (single fetch only).
- Exact context/output limits per ClinePass model from any first-party ClinePass source — they are
  simply not published (the "1M context window" phrases in descriptions are prose, not structured data,
  and don't cover every model).
- Whether the endpoint's `clinePass` array is regionalized or A/B-varied per client (it was consistent
  across the fetches made here, and matched the docs table).

## Recommendation for the collector design

**Primary source: the public JSON endpoint** `https://api.cline.bot/api/v1/ai/cline/recommended-models`,
read the `clinePass[]` array. No auth, machine-readable, and it's the same call the Cline app makes — the
most robust roster source. Map `id → provider_model_id`, `description` → recommendation notes.

**Secondary source (same collector run): the docs Markdown table**
`https://docs.cline.bot/getting-started/clinepass.md`. Parse the `## Models` table for the pretty
`display_name` (join on Model ID) and the `## Reference pricing` table for `pricing.input`,
`pricing.output`, and `pricing.cached` (read; note cache-write and Qwen's ≤/>256K tiering exist but our
shape has no slot for a write-cache or per-context-tier price — collapse to the base tier and record the
nuance in provenance). Prefer the `.md` over HTML scraping; if you must fall back to HTML, the stable
selector is the `#models` section's `table` with a `<code>cline-pass/…</code>` in the second cell.

**Enrichment (mirror Cline's own logic): context/output/capabilities via the OpenRouter join.** Strip the
`cline-pass/` prefix and look the slug up against our OpenRouter offerings (via `canonical_model.id`) for
`context_tokens`, `max_output_tokens`, and `capabilities`; when there's no match, apply Cline's
documented defaults (128000 / 8192 / `["tools","reasoning","temperature"]`) and mark those fields
lower-confidence. This reuses the canonicalization the feed already needs and keeps us aligned with how
the product itself resolves these.

**Provenance / staleness:** set `last_verified_at` to fetch time on every run (the endpoint has no
version stamp). Record two `source_claims`: the roster/description claim → `source_url` =
the `recommended-models` endpoint; the pricing/display-name claim → `source_url` =
`https://docs.cline.bot/getting-started/clinepass`. Flag the pricing as **reference-only / flat-rate
bundle** (the docs explicitly say the subscription doesn't bill these per-token). Because the roster is
hand-maintained (last change 2026-06-29), a diff-alert when the endpoint's `clinePass` id set changes is
worth adding.

**Do not** hand-maintain a static roster file: the live endpoint removes the need, and a static copy
would miss additions like the 2026-06-29 model drop.

---

# Adding the regular Cline provider (recommended + free)

> Research note, 2026-07-13 (follow-up to the ClinePass note above). Question: add the **regular Cline
> provider** — "Cline (usage-billing)", the metered pay-as-you-go provider, plus its free-tier models — as
> a source. Same public endpoint (`recommended-models`) also returns `recommended[]` and `free[]`. All
> claims verified by live `curl` / GitHub-API reads on 2026-07-12/13.

## Verdict

**The regular Cline provider is OpenRouter's catalog rebranded — do NOT model it as an independent
roster.** Cline's own SDK maps `runtimeProviderId: "cline"` to models.dev provider key **`openrouter`**
and pulls all pricing/context/capability metadata from **`https://models.dev/api.json`**; the docs state
its model IDs use "the same convention used by OpenRouter". Its full "100+ model" catalog is **not
publicly enumerable** (gated behind the authenticated `/api/v1/models`, HTTP 401). The only public,
first-party, structured Cline-specific data is the **curated `recommended[]` (5) and `free[]` (4)** arrays
from the same `recommended-models` endpoint — these are marketing/onboarding shortlists, not the catalog.
**Recommendation:** treat "regular Cline" as one provider `cline` with a free/paid split via
`pricing.kind`; populate it by reusing our existing OpenRouter offerings (same `provider/model` slugs,
same models.dev/OpenRouter pricing), tagging the ~9 curated ids as recommended/free. If we don't want a
near-duplicate of the OpenRouter provider, the honest call is to **skip it** or add only the curated
shortlist as annotations on the matching OpenRouter offerings.

## 1. The `recommended[]` and `free[]` arrays

Same endpoint as before: `https://api.cline.bot/api/v1/ai/cline/recommended-models` (public, no auth).
Full contents (fetched 2026-07-12):

**`recommended[]` — 5 entries, all tagged `NEW`:**
```json
{"id":"openai/gpt-5.6-sol","name":"gpt-5.6-sol","description":"OpenAI's latest frontier coding model","tags":["NEW"]}
{"id":"x-ai/grok-4.5","name":"grok-4.5","description":"SpaceXAI's smartest model with frontier performance on coding","tags":["NEW"]}
{"id":"zai/glm-5.2","name":"glm-5.2","description":"Best open weights model","tags":["New"]}
{"id":"moonshotai/kimi-k2.7-code","name":"kimi-k2.7-code","description":"Best open-weights model available","tags":["NEW"]}
{"id":"anthropic/claude-opus-4.8","name":"Claude Opus 4.8","description":"Anthropic's latest flagship model","tags":["NEW"]}
```

**`free[]` — 4 entries, no tags:**
```json
{"id":"deepseek/deepseek-v4-flash","name":"deepseek-v4-flash","description":"Fast and efficient with 1M context window "}
{"id":"stepfun/step-3.7-flash","name":"step-3.7-flash","description":"Fast vision capable model built for agents "}
{"id":"tencent/hy3:free","name":"hy3:free","description":"Newest open model with leading agent skills "}
{"id":"poolside/laguna-m.1:free","name":"laguna-m.1:free","description":"Frontier model built for agentic coding "}
```

- **Overlap:** none — `recommended ∩ free = ∅` (distinct sets).
- **Namespace:** `provider/model` slugs (`openai/…`, `x-ai/…`, `zai/…`, `anthropic/…`, `deepseek/…`,
  `tencent/…:free`, `poolside/…:free`) — **the OpenRouter convention**, not the `cline-pass/…` namespace
  used by ClinePass. Two `free[]` ids carry OpenRouter's `:free` variant suffix; two do not — so free-ness
  is **not** reliably encoded in the slug.
- **These are curated shortlists, not the catalog.** The docs say the regular provider gives "access to
  100+ models"; the endpoint only surfaces 5 recommended + 4 free. There is no public enumeration of the
  other ~90+.
- Source: `https://api.cline.bot/api/v1/ai/cline/recommended-models` (fetched 2026-07-12).
- Source: `https://docs.cline.bot/getting-started/cline-provider.md` — "access to 100+ models supported by Cline".

## 2. Is there a richer endpoint? — No public one; it's OpenRouter via models.dev

- **The full catalog is gated.** `https://api.cline.bot/api/v1/models` → **HTTP 401** (needs a Cline API
  key, `Authorization: Bearer`). That is the OpenAI-compatible catalog for the regular provider; not
  usable unauthenticated.
- **The app resolves regular-provider metadata from models.dev, keyed as OpenRouter.** In `cline/cline`:
  - `sdk/packages/core/src/services/llms/provider-defaults.ts`:
    `export const DEFAULT_MODELS_CATALOG_URL = "https://models.dev/api.json";`
  - `sdk/packages/llms/src/providers/provider-keys.ts` maps the regular provider:
    ```ts
    { modelsDevKey: "openrouter", generatedProviderId: "openrouter", runtimeProviderId: "cline" }
    ```
    i.e. runtime provider **`cline` == models.dev/OpenRouter catalog**.
  - `sdk/packages/llms/src/catalog/catalog-live.ts` (`fetchLiveProviderModels(modelsDevUrl, …)`) fetches a
    models.dev-shaped payload (`cost.input/output/cache_read/cache_write`, `limit.context/input/output`,
    `tool_call`, `reasoning`, `modalities`) and merges the `recommended-models` list on top.
  - `sdk/packages/llms/src/catalog/catalog.generated.ts` (~540 KB) is a **checked-in snapshot generated
    from models.dev** (per the dir's `README.md`: "Most built-in catalog data comes from models.dev
    through `catalog-live.ts` and is written to `catalog.generated.ts`").
- **No separate unauthenticated Cline pricing/models endpoint exists.** The regular provider's prices are
  OpenRouter's prices, sourced from models.dev.
- The API docs confirm the OpenRouter lineage: model IDs are `provider/model-name`, "the same convention
  used by OpenRouter" (`https://docs.cline.bot/api/models.md`).
- Sources: the four `cline/cline` files above (fetched via GitHub API 2026-07-12);
  `https://api.cline.bot/api/v1/models` (HTTP 401, 2026-07-12); `https://docs.cline.bot/api/models.md`.

## 3. Field availability (regular + free)

| Field (ModelOffering)         | `recommended-models` endpoint | models.dev / OpenRouter join | Docs |
|-------------------------------|-------------------------------|------------------------------|------|
| `provider_model_id`           | ✅ `id` (`openai/gpt-5.6-sol`) | ✅ same slug                  | pattern documented (`provider/model-name`) |
| `display_name`                | ⚠️ `name` (mostly the slug; one pretty: "Claude Opus 4.8") | ✅ models.dev `name` | — |
| `description`                 | ✅ blurb + `tags[]` (`NEW`)    | ✗                            | — |
| pricing `input`/`output`      | ✗                             | ✅ models.dev `cost.input/output` (per-1M) | — |
| pricing `cached` read/write   | ✗                             | ✅ `cost.cache_read/cache_write` | — |
| `context_tokens`              | ✗ (prose only, e.g. "1M")     | ✅ `limit.context`           | — |
| `max_output_tokens`           | ✗                             | ✅ `limit.output`            | — |
| `capabilities`                | ✗                             | ✅ `tool_call`,`reasoning`,`structured_output`,`temperature`,`modalities.input` (image→images, pdf→files) | docs name `supportsReasoning`/`supportsImages` |

So **every substantive field for the regular provider comes from the models.dev / OpenRouter join**, not
from any Cline-first-party source. The `recommended-models` endpoint contributes only the curated
membership + `NEW` tag + a one-line description. There is **no per-model docs table** for the regular
provider (`cline-provider.md` is prose only; `api/models.md` documents the ID format and gives a
"choosing a model" cheat-sheet, not a roster).

## 4. Free-tier semantics

- **Genuinely $0 to run** — the docs frame free models as testing "without spending credits" ("Try a Free
  Model … To test without spending credits, use one of the free models"). Two of the four use OpenRouter's
  `:free` variant suffix, which is $0 on OpenRouter.
  Source: `https://docs.cline.bot/llms-full.txt` (§ "Try a Free Model", referencing `/api/models#free-models`).
- **Requires a Cline account + API key.** Access is through the authenticated Cline API/provider (sign in
  with Google/GitHub/email; requests use `Authorization: Bearer YOUR_API_KEY`). So "free" ≠
  "anonymous" — an account is the gate.
  Source: `https://docs.cline.bot/getting-started/cline-provider.md`; `https://docs.cline.bot/api/models.md`.
- **Data/privacy:** Cline documents "**No model training** — Your code and prompts aren't used for
  training" and "Repositories are never indexed or cached" — so no training-data catch.
  Source: `https://docs.cline.bot/llms-full.txt` (privacy cards).
- **Could not determine from primary sources:** explicit per-free-model **rate limits, quotas, or
  expiry** for the regular provider's free tier. The docs only say to "look for models tagged FREE in the
  selector"; no numeric limits or sunset dates are published on these pages. (Contrast ClinePass, whose
  5-hour/weekly/monthly windows *are* documented.) The `free[]` membership is also liable to rotate —
  treat it as volatile.

## 5. Provider modeling — one `cline` provider, free/paid split

Cline's own product treats it as **one provider with free options inside it**, and ClinePass as a
**separate** provider:

- "Cline (usage-billing) is the pay-as-you-go provider… **Free options: look for models tagged FREE in
  the selector**." — one provider, FREE is a per-model tag, not a separate provider.
  (`https://docs.cline.bot/getting-started/cline-provider.md`)
- "ClinePass is a **separate provider** in Cline." (`https://docs.cline.bot/getting-started/clinepass.md`)

**Recommendation:** model the regular provider as a single feed provider **`cline`**, with the free tier
expressed via `pricing.kind` (`free` / `free_tier` vs `paid`) on individual offerings — mirroring how our
existing collectors already split free vs paid. Keep **`cline-pass`** as a distinct provider (separate
namespace `cline-pass/…`, flat-rate reference pricing). Do not fold the two together.

## Collector-design recommendation (keyed to ModelOffering)

**Relationship to the ClinePass collector:** one shared fetch, three record groups. A single call to
`https://api.cline.bot/api/v1/ai/cline/recommended-models` returns `{ recommended, free, clinePass }`.
Fetch once; emit ClinePass offerings from `clinePass[]` (provider `cline-pass`, per the section above) and
regular-Cline offerings from `recommended[]` + `free[]` (provider `cline`). Don't fetch the endpoint
twice.

For the **regular `cline` provider** specifically:

- `provider_model_id` ← endpoint `id` (`openai/gpt-5.6-sol`, `deepseek/deepseek-v4-flash`, …).
- `display_name` ← models.dev `name` (fall back to endpoint `name`, which is usually the slug).
- `pricing.input/output/cached` ← **join to models.dev `openrouter` / our existing OpenRouter offerings by
  the identical `provider/model` slug** (`cost.input`, `cost.output`, `cost.cache_read`; strip a trailing
  `:free` when matching). These are real per-1M metered rates. Set `pricing.kind = free`/`free_tier` for
  everything in `free[]`, `paid` for `recommended[]`.
- `context_tokens` ← models.dev `limit.context`; `max_output_tokens` ← `limit.output`.
- `capabilities` ← models.dev flags (`tool_call`→tools, `reasoning`→reasoning, `structured_output`,
  `temperature`, `modalities.input` image→images / pdf→files). Cline's fallback when a slug is missing is
  128000 ctx / 4096 out (regular provider default) — apply that only as a last resort and mark it
  low-confidence.
- Provenance: two `source_claims` — membership/description/`NEW` tag → `source_url` = the
  `recommended-models` endpoint; pricing/context/capabilities → `source_url` = `https://models.dev/api.json`
  (attribute models.dev, as our existing model-quality note already prescribes for it). Set
  `last_verified_at` to fetch time. Flag `free[]` membership as **volatile** (curated shortlist, may
  rotate; no documented rate limits/expiry).

**Caveat worth surfacing to the coordinator:** because the regular `cline` provider *is* OpenRouter's
catalog under a Cline label, adding it produces offerings that largely **duplicate** our existing
OpenRouter provider (same slugs, same models.dev pricing, same benchmarks). The net-new signal is thin:
the `recommended`/`free` curation flags and the `NEW` tags. Consider whether that justifies a full
provider, versus attaching a `cline_recommended` / `cline_free` boolean (and the description/tag) to the
matching OpenRouter offerings. ClinePass, by contrast, is genuinely distinct (its own `cline-pass/…`
namespace, flat-rate model, reference pricing not on OpenRouter) and clearly warrants its own provider.
