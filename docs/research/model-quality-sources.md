# External sources for model capabilities and quality scores

> Research note, 2026-07-11. The repo had no research convention (docs/ holds PRD/, adr/, agents/), so this
> file starts `docs/research/`. Question: which external sources can augment our catalog with capability
> metadata and quality scores (coding, reasoning, speed), so users and orchestrators can pick the right
> model per task? All endpoint claims below were verified by live fetch on 2026-07-10/11.

## TL;DR recommendation

1. **First: OpenRouter's embedded `benchmarks` field** — zero new integration. Our existing OpenRouter
   collector already downloads Artificial Analysis intelligence/coding/agentic indexes for 105 of 346
   models and Design Arena Elo for 110 (verified in the live payload). Map them into `quality.*` and
   propagate to same-model offerings on Groq/Gemini/GitHub Models via `canonical_model.id`.
2. **Second: models.dev** (`https://models.dev/api.json`, MIT-licensed, community-maintained) — no quality
   scores, but exact provider/model-ID coverage of all four of our providers for capability flags
   (tool_call, reasoning, attachment), modalities, limits, cost, knowledge cutoff, release dates,
   open_weights. Best source for enriching and cross-checking capability metadata; trivial ID matching.
3. **Later, if speed scores matter: Artificial Analysis' own API** (free key, 1,000 req/day, attribution
   required) adds `median_output_tokens_per_second` and `median_time_to_first_token_seconds`, which the
   OpenRouter embed does not carry.

## Source-by-source findings

### OpenRouter `/api/v1/models` embedded benchmarks — integrate first

- **What**: 105/346 models carry `benchmarks.artificial_analysis` = `{intelligence_index, coding_index,
  agentic_index}` (0–100 scale); 110 carry `benchmarks.design_arena` = per-category `{arena, category,
  elo, win_rate, rank}` entries. Verified by inspecting the live payload our collector already fetches
  (2026-07-10 snapshot; e.g. `openai/gpt-5.6-luna`: intelligence 51.2, coding 71.4, agentic 45.6).
- **API**: already integrated — same authenticated call the openrouter collector makes.
- **Licensing**: OpenRouter republishes Artificial Analysis data; we should still attribute Artificial
  Analysis (their documented requirement, see below) and Design Arena in the claim's `source_url`.
- **Cadence**: refreshed with OpenRouter's catalog (continuous).
- **ID matching**: free for `openrouter:*` offerings. For the other providers, join through our
  `canonical_model.id` (e.g. `openrouter:meta-llama/llama-3.3-70b-instruct` ↔
  `groq:llama-3.3-70b-versatile` requires canonical-model normalization — the join is on the underlying
  model, not the offering).

### models.dev — integrate second

- **What**: open-source database of model specs: capability booleans (`reasoning`, `tool_call`,
  `attachment`, `temperature`), `modalities.input/output`, `limit.context/output`, `cost.input/output`
  (USD per 1M), `knowledge` cutoff, `release_date`, `open_weights`. No benchmark scores.
  (https://models.dev, README: "a comprehensive open-source database of AI model specifications,
  pricing, and capabilities")
- **API**: `https://models.dev/api.json` — verified live, 200, ~3.1 MB, no auth. 158 providers keyed by
  provider id, models keyed by provider model id. Also `models.json` / `catalog.json` variants
  (https://github.com/sst/models.dev README).
- **Coverage** (verified in the fetched payload): `groq` (15 models, includes
  `llama-3.3-70b-versatile`), `google` (23, includes `gemini-2.5-pro`), `github-models` (55, includes
  `openai/gpt-4.1-mini`), `openrouter` (346, includes `openai/gpt-4o`). ID matching: exact string match
  on our `provider_model_id` (only mapping needed: their `google` = our `gemini`).
- **Licensing**: MIT (repo footer/license, https://github.com/sst/models.dev).
- **Cadence**: community PRs, schema-validated by CI; effectively continuous but best-effort (README
  invites contributions to keep data current).

### Artificial Analysis (direct API) — when we want speed metrics

- **What**: `GET /data/llms/models` returns intelligence/coding/math indexes, underlying benchmark
  scores (MMLU-Pro, GPQA, LiveCodeBench, SciCode, Math 500, AIME), speed
  (`median_output_tokens_per_second`, `median_time_to_first_token_seconds`) and per-token pricing
  (https://artificialanalysis.ai/documentation).
- **API**: free key via account, `x-api-key` header, 1,000 requests/day; commercial tier for more.
- **Licensing**: "Attribution is required for all use of our free API. Please provide attribution to
  https://artificialanalysis.ai/" (documentation, fetched 2026-07-11). They recommend caching responses
  and using stable model/creator IDs rather than slugs.
- **Cadence**: continuous (they re-benchmark on releases).
- **ID matching**: their own model/creator IDs; moderate effort — same canonical-model join problem as
  the OpenRouter embed, but they measure per *endpoint* in places (useful: their Groq endpoints carry
  Groq-specific speed numbers).

### LMArena — viable later, annoying ID matching

- **What**: crowd-sourced pairwise Elo (Bradley-Terry ratings with CIs, vote counts) per category
  (text, coding, vision, agents…). Quality signal is preference-based, not task-accuracy.
- **API/feed**: official HF dataset `lmarena-ai/leaderboard-dataset` (historical snapshots in a `full`
  split); no official REST API (their space discussion declines one). Third-party mirrors exist
  (e.g. github.com/oolong-tea-2026/arena-ai-leaderboards, MIT) but add a trust hop.
- **Licensing**: CC-BY-4.0 (dataset card, fetched 2026-07-11) — republication fine with attribution.
- **Cadence**: snapshot-based, roughly weekly publishes.
- **ID matching**: hard — models identified by display strings like "Claude Fable 5 (High)" +
  organization, not slugs. Needs a hand-maintained alias table.

### Not recommended now

- **Epoch AI** (https://epoch.ai/data/ai-models): CC-BY CSVs of training compute/params/cost for
  *notable foundation models*; explicitly non-exhaustive, no API-variant coverage
  (no `llama-3.3-70b-versatile`-level entries), no task scores. Wrong granularity for our feed.
- **HELM** (crfm.stanford.edu/helm): rigorous academic benchmark suite, raw JSON per run; slow cadence,
  weak coverage of current commercial API variants, heavy aggregation work. Revisit for methodology, not
  as a live feed.
- **LiveBench** (livebench.ai): contamination-free monthly benchmark; leaderboard data lives in HF
  datasets of per-judgment rows (needs aggregation via their `download_leaderboard.py`); display-name
  matching; license unclear on the leaderboard data itself. Coding category could be a good
  `coding_score` cross-check later.
- **HuggingFace Hub API**: popularity signals (downloads, likes) and model cards only; the Open LLM
  Leaderboard is retired. No quality scores for closed models — not a fit.

## Mapping into our schema

`src/feed/schema.ts` defines `quality.coding_score`, `quality.reasoning_score`, `quality.speed_score` as
`z.number().nullable()` — unit-free. Proposal:

- `coding_score` ← Artificial Analysis `coding_index` (0–100), via the OpenRouter embed.
- `reasoning_score` ← Artificial Analysis `intelligence_index` (0–100). (Their `agentic_index` has no
  schema slot today — either add `quality.agentic_score` or put it in `recommendation_notes`;
  the schema's `.passthrough()` also tolerates an extra field.)
- `speed_score` ← Artificial Analysis `median_output_tokens_per_second`, only available via their direct
  API — leave `null` in phase 1.
- Every enriched field gets a `source_claims` entry with the existing `third_party_catalog` source type
  (already in `sourceTypeSchema`), `source_url` pointing at the owning source, `confidence: "medium"`,
  and a `raw_reference` json-pointer into the snapshot — same pattern all four collectors use today.
- Cross-provider propagation (giving `groq:*`/`gemini:*` offerings the scores measured for the same
  underlying model) hinges on `canonical_model.id` being genuinely canonical. Today each collector uses
  its own provider model id as canonical with confidence "medium" — a canonicalization pass (models.dev
  families or a small alias map) is the prerequisite for score propagation and belongs in the same
  ticket.
