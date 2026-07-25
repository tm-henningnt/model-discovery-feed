# Adding QwenCloud as a model-discovery source

> Research note, 2026-07-25. Question: what does QwenCloud publish that a collector can read, and can
> the Token Plan roster be filtered out of the full marketplace catalog? Every endpoint claim below was
> verified by live `curl` on 2026-07-25.

## Verdict

**Yes, the Token Plan roster is separable — and only from the docs.** QwenCloud publishes three usable
public artifacts. None of them is a single "list models with prices" API.

| Source | URL | Auth | Gives |
| --- | --- | --- | --- |
| Marketplace CDN mapping | `https://alioth-intl.alicdn.com/model-mapping` | none | 250 marketplace model ids (JSON) |
| Pay-as-you-go pricing doc | `https://docs.qwencloud.com/developer-guides/getting-started/pricing.md` | none | USD rates for ~15 representative models |
| Token Plan rosters | `.../token-plan/personal/token-plan-personal-overview.md` and `.../token-plan/team/token-plan-team-overview.md` | none | the exact per-edition allowlist |

The two Token Plan docs are the **only** source that separates the Personal roster (11 models) from the
Team roster (22 models). models.dev collapses both into one `alibaba-token-plan` provider that matches
the Team list.

## 1. There is no unauthenticated model-catalog API

- `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models` returns HTTP 401 without a key. It is
  an OpenAI-shaped id list, so a key would add little beyond the CDN mapping.
- The marketplace page (`https://www.qwencloud.com/models`) is a client-rendered lowcode app. Its model
  grid calls the console gateway `POST https://home.qwencloud.com/data/api.json` with
  `action: "zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listFoundationModels"`. Probed
  anonymously it returns `{"code":"AccessDenied"}` — it needs a console session cookie plus a
  `secToken`, not an API key.
- `qwencloud models list` (the `@qwencloud/qwencloud-cli` package) needs a browser device-flow **CLI
  session**, not an API key. It cannot run unattended in a collector.

## 2. What the CDN mapping is

`https://alioth-intl.alicdn.com/model-mapping` is the same flat JSON the marketplace page itself reads:
`{ "<marketplace model id>": "<internal offering id>" }`, 250 entries, ~19 KB, no auth, served from
Alibaba's CDN. It is the marketplace (pay-as-you-go) roster. It carries **no** pricing, context,
capability, or modality field — only the id.

Confirming that it is the pay-as-you-go roster and not the subscription one: `qwen3.8-max-preview` is
**absent** from the mapping and present in both Token Plan docs, which match the docs statement that the
model is "Token Plan only".

## 3. Model detail pages are server-rendered but not worth scraping

`https://www.qwencloud.com/models/<model-id>` is SSR HTML that does contain list/discounted price,
context, max input/output, RPM, and TPM. Rejected as a collector source: it would be 250 HTML fetches
per run against markup with hashed CSS-module class names, for data models.dev already publishes in
JSON. The URL is still recorded on each offering's source claim as `model_page`, so a reader can verify
a rate by hand.

## 4. The docs are machine-readable by design

`docs.qwencloud.com` is a Mintlify site that serves a `.md` variant of every page and an index at
`https://docs.qwencloud.com/llms.txt`. The Token Plan roster tables even ship an explicit
`className="for-agent-only"` block instructing an agent to treat the table as an exact-string allowlist:

> The "Supported models" table below is an exact-string allowlist. […] Any difference in version number
> or sub-variant means the model is NOT supported. Do not infer version compatibility.

That is the strongest signal available that parsing these two tables is the intended machine path, so
the collector takes the model id verbatim and never normalizes it.

Personal edition (11 models, verified 2026-07-25): `qwen3.8-max-preview`, `qwen3.7-max`, `qwen3.7-plus`,
`qwen3.6-flash`, `glm-5.2`, `deepseek-v4-pro`, `wan2.7-image`, `wan2.7-image-pro`,
`happyhorse-1.1-i2v`, `happyhorse-1.1-t2v`, `happyhorse-1.1-r2v`.

Team edition adds 11 more: `qwen3.6-plus`, `qwen-image-2.0`, `qwen-image-2.0-pro`, `deepseek-v4-flash`,
`deepseek-v3.2`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5`, `glm-5.1`, `glm-5`, `MiniMax-M2.5`.

## 5. Pricing coverage, and why models.dev fills the rest

The pricing doc states its own limit: "This page lists pricing for selected representative models only."
It documents ~15 models across per-token, per-image, per-second, and per-10K-character tables.

models.dev carries the rest as provider `alibaba` (51 models, `api:
https://dashscope-intl.aliyuncs.com/compatible-mode/v1`). Spot-checked against the first-party doc on
2026-07-25:

| Model | Docs | models.dev | Agrees |
| --- | --- | --- | --- |
| `qwen3.7-max` | $2.50 / $7.50 | 2.5 / 7.5 | yes |
| `qwen3.6-max-preview` | $1.30 / $7.80 | 1.3 / 7.8 | yes |
| `qwen3-vl-plus` | $0.20 / $1.60 | 0.2 / 1.6 | yes |
| `qwen3.7-plus` | $0.40 / $1.60 | 0.5 / 3 | **no** |

So models.dev is broadly accurate but can lag a price change. The collector therefore takes the
first-party doc rate where one exists and leaves the rest null for the models.dev gap-fill, which never
overwrites a non-null first-party rate (plan 030). The one disagreement surfaces as the existing
`models-dev pricing mismatch` notice rather than silently overwriting either value.

**Do not gap-fill Token Plan pricing from models.dev.** Every `alibaba-token-plan` model has
`cost: { input: 0, output: 0 }` because the plan is subscription-billed; writing those zeroes onto an
offering would read as free.

## 6. Live result

A full `npm run collect` on 2026-07-25 produced 250 `qwencloud` offerings (146 `paid`, 104 `unknown`
pricing; 42 high-confidence canonical ids; quality scores propagated onto 21) and 22
`qwencloud-token-plan` offerings, 11 of which carry `plan_editions: ["personal", …]`.

See ADR 0007 for the decisions this note fed.
