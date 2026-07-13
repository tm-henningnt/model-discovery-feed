# How to represent GitHub Models pricing in the feed

> Research note, 2026-07-13. Question: our `github-models` collector produces zero pricing (every
> offering has null input/output). How should a GitHub Models offering's `pricing` be represented, and
> is it safe to gap-fill per-token numbers from models.dev's `github-models` provider entry the way we
> do for OpenCode? Primary sources only (docs.github.com, the live catalog API, models.dev's live
> payload); all endpoint/doc claims verified by live fetch on 2026-07-13.

## TL;DR recommendation

**Do not gap-fill per-token numbers, and do not leave it `unknown`. Represent a `github-models`
offering as `pricing.kind = "free_tier"` with a populated `pricing.free` block (rate-limit note in
`quota`, `requires_account`/`requires_api_key` true) and both per-token fields left `null`.** That
matches the default experience every account actually gets — a rate-limited free preview — without
asserting a per-token number that would be wrong either way:

- models.dev's `github-models` entry does **not** carry the creator list price. It carries **`{input:
  0, output: 0}` for all 55 models** — i.e. it models GitHub Models as *free*. Gap-filling it (our
  enricher turns `0/0` into `kind: "free"`) would assert the offering is permanently free and hide the
  paid production tier. (The task's premise that models.dev has "per-token cost values for ~31 of 37"
  is off: the `cost` object is present but every value is `0`.)
- Hardcoding the creator's list price instead would *also* be wrong: GitHub's paid tier does **not**
  bill at the creator's standard rate — it uses its own token-unit × per-model-multiplier scheme
  (below). Any single per-token number misrepresents actual cost.

## 1. Billing model

GitHub Models is **a free, rate-limited public preview by default, with an opt-in paid "production"
tier** — not free-then-creator-rates, and not bundled into a subscription for the direct-API surface.

- **Free by default, rate-limited, still preview.** "GitHub provides free API usage so that you can
  experiment with AI models in your own application." and "The free API usage is in public preview and
  subject to change." — <https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models>
  "All GitHub accounts have rate-limited access to GitHub Models at no cost." —
  <https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-models>
- **Opt-in paid tier exists (per-token, GitHub's own units).** "Once you opt in to paid usage, you
  will have access to production grade rate limits and be billed for all usage thereafter." and "GitHub
  Models pricing is based on the number of token units used, at a fixed price of $0.00001 USD per token
  unit." with "A token unit is calculated by multiplying the number of input and output tokens by their
  respective model multipliers." —
  <https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-models>
- **The per-model multipliers are GitHub's scheme, not the creator list price.** "Each model supported
  by GitHub Models has an input and output multiplier that determines the number of token units for
  each request." — <https://docs.github.com/en/billing/reference/costs-for-github-models> (e.g. GPT-4o
  carries an input multiplier of 0.25 and output multiplier of 1.0, so the effective per-token cost is
  a GitHub-derived figure, not OpenAI's headline list price). Copilot subscriptions affect the free
  rate-limit ceiling ("Limits also vary according to your GitHub Copilot plan"), but the direct GitHub
  Models API bills its own token units, not a flat subscription inclusion.
- **GA status:** still **public preview** for the free API usage and playground ("The free API usage is
  in public preview and subject to change"; "The model playground is in public preview and subject to
  change") — the billing docs are live, so the paid tier is operational, but the surface is not
  announced as GA.

## 2. What the catalog API exposes

`GET https://models.github.ai/catalog/models` (works unauthenticated; returned 37 entries on
2026-07-13) exposes **no pricing, cost, or tier field of any monetary kind**. A model entry's fields
are exactly: `id, name, publisher, summary, rate_limit_tier, supported_input_modalities,
supported_output_modalities, tags, registry, version, capabilities, limits{max_input_tokens,
max_output_tokens}, html_url`. Sample (verbatim):

```json
{"id":"openai/gpt-4.1","name":"OpenAI GPT-4.1","publisher":"OpenAI","rate_limit_tier":"high",
 "supported_input_modalities":["text","image"],"registry":"azure-openai","version":"2025-04-14",
 "capabilities":["agents","streaming","tool-calling","agentsV2"],
 "limits":{"max_input_tokens":1048576,"max_output_tokens":32768}}
```

- **`rate_limit_tier` is a rate/QoS class, not a price.** Observed values: `"low"`, `"high"`,
  `"custom"`, `"embeddings"`. Per the docs it maps to requests-per-minute in the free tier, and the
  semantics are counter-intuitive: **`"low"` models get the *higher* free rate limit (~15 req/min) and
  `"high"` models the *lower* limit (~10 req/min)** — "low"/"high" describes the model's resource
  weight, inversely to how many free calls you get.
  (<https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models>)
- **Note a latent collector bug:** `src/collectors/github-models.ts:85` sets `availability.status`
  to `"limited"` when `rate_limit_tier === "low"`. Given the inverse semantics above, "low" is the
  *more generously* rate-limited class — flagging it as `limited` is backwards. Worth revisiting when
  we touch this collector for pricing.

## 3. Do models.dev's github-models `cost` numbers match GitHub's charge or the creator price?

**Neither — they are all zero.** Verified against the live `https://models.dev/api.json`
(2026-07-13): the `github-models` provider has 55 models and **every one has `cost: {input: 0,
output: 0}`** (distribution check: 55/55 at input `0`). By contrast the underlying creator's own
provider entry carries the real list price:

| model | models.dev `github-models` cost | models.dev creator-provider cost |
|---|---|---|
| `openai/gpt-4.1` | `{input: 0, output: 0}` | `openai.gpt-4.1` → `{input: 2, output: 8, cache_read: 0.5}` |
| `openai/gpt-4o` | `{input: 0, output: 0}` | `openai.gpt-4o` → `{input: 2.5, output: 10, cache_read: 1.25}` |
| `meta/llama-3.3-70b-instruct` | `{input: 0, output: 0}` | — |

So models.dev is **not** relaying the creator list price into its `github-models` entry, and it is not
relaying GitHub's token-unit price either — it is asserting **free**, consistent with the default
preview being $0. models.dev does not document a source for github-models pricing; the `0/0` is best
read as "the community entry reflects the free preview," not a verified GitHub-specific rate.

## 4. Recommendation for our feed

Choose **(b), the free-tier representation, shading toward (d)** — and explicitly reject (c):

- **Set `pricing.kind = "free_tier"`.** This is the honest default: rate-limited, no charge, no
  per-token number.
- **Populate `pricing.free`** (the schema block at `src/feed/schema.ts:157` — the `kind === "free"`
  guard at line 252 does not fire for `free_tier`, but we should fill it anyway):
  - `is_currently_free: true`
  - `basis: "account_free_tier"` (from `freeBasisSchema` — the correct basis; not `zero_priced_model`,
    which would imply the model itself is priced at zero rather than gated behind a free quota)
  - `requires_account: true`, `requires_api_key: true` (needs a `GITHUB_TOKEN`)
  - `requires_credit_card: false`
  - `quota`: a short rate-limit note, e.g. `"Rate-limited public preview; free req/min set by
    rate_limit_tier and Copilot plan. Opt into paid usage for production limits."` — this is where the
    `rate_limit_tier` value earns its place.
  - `confidence: "medium"`, `last_verified_at` = run time.
- **Leave `input_usd_per_1m_tokens` / `output_usd_per_1m_tokens` `null`.** Optionally record the paid
  tier in `recommendation_notes` (the token-unit-multiplier scheme) rather than inventing a per-token
  number — that is the (d) flavor, capturing "free for prototyping + paid per-token for production"
  without a misleading figure.

**Why not the alternatives:**

- **(a) leave `unknown`** — technically safe but strictly worse than `free_tier`: it hides that every
  account gets real free access, and it makes GitHub Models sort as "cost unknown" against providers we
  *do* mark free, so it under-surfaces a genuinely free option to orchestrators.
- **(c) gap-fill per-token from models.dev** — actively misleading. models.dev's `github-models`
  cost is `0/0`, so our enricher (`src/enrichers/models-dev.ts:189`) would set `kind: "free"` with
  `basis: "zero_priced_model"` — asserting the offering is *unconditionally* free and erasing the
  paid production tier and the rate limits. And `github-models` is deliberately **not** in
  `pricingGapFillAllowed` today (only `opencode-go`/`opencode-zen` are) — OpenCode's own API genuinely
  publishes no pricing and models.dev is what the OpenCode CLI itself reads, so models.dev is
  authoritative there. For GitHub Models the authoritative pricing source is GitHub's own billing
  docs (token units × multipliers), which models.dev does not carry — so the OpenCode rationale does
  not transfer. **Keep `github-models` out of `pricingGapFillAllowed`.**

**The trade-off in one line:** any per-token number we publish for GitHub Models is wrong — `0`
denies the paid tier, and the creator list price denies GitHub's own multiplier scheme — so the only
non-misleading representation is `free_tier` + a rate-limit `quota` note + null per-token, with the
paid-tier mechanics in notes.
