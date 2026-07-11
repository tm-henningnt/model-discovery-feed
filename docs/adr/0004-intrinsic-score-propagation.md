# ADR 0004: Propagate intrinsic scores across confident canonical joins

Status: Accepted

## Context

The same underlying model is offered by several providers, while intrinsic quality scores are often
measured or republished on only one offering. Endpoint performance is different: throughput and
time-to-first-token depend on the provider serving the model and cannot describe the model alone.

Canonical IDs make cross-provider score reuse possible, but a mistaken or low-confidence identity
join would publish another model's scores on an unrelated offering.

## Decision

- Propagate only intrinsic fields: coding, reasoning, agentic, math, Artificial Analysis
  sub-benchmarks, and Design Arena ratings.
- Never propagate endpoint fields: `speed_score` and `benchmarks.ttft_seconds` remain specific to
  measurements matched to the recipient provider endpoint.
- Require both the donor and recipient to have the same `canonical_model.id` at high confidence.
  Medium-confidence echo IDs are not join keys.
- Treat a non-null intrinsic value with a high-confidence AA or Design Arena claim as direct
  evidence. When several direct claims exist, prefer the donor whose claim points to Artificial
  Analysis. If direct values disagree, publish using the preferred donor's value and emit a
  `score-propagation` collector notice recording the canonical ID, field, preferred donor, and every
  conflicting donor — a data inconsistency between two direct sources must not abort the whole feed;
  it is surfaced for correction at the canonical alias or source-precedence layer instead.
- Fill null recipient fields only. Preserve every existing value, and attach a medium-confidence
  claim that records the canonical ID, donor offering ID, donor claim, and original source. When
  multiple offerings tie as equally-valid AA-sourced donors (e.g. an OpenRouter base offering and its
  `:free` variant), prefer the non-variant offering id for provenance so which donor gets cited does
  not depend on collector payload ordering.
- The AA-direct enricher (plan 029) attaches its claims only to `openrouter:*` offerings — other
  providers receive intrinsic scores exclusively through this propagation stage. Consequence: a
  model AA scores by name but that has no OpenRouter alias (no `canonical_model.confidence: "high"`
  entry) gets no score at all, from either enricher. Confirmed live 2026-07-11: 6 of 453 offerings
  (GitHub Models' o1-mini, o1-preview, mistral-medium-2505, mistral-small-2503, phi-4-mini-instruct,
  phi-4-multimodal-instruct). Accepted as a bounded gap rather than adding a dependency from the AA
  enricher on this stage's canonical grouping; see spec section 9.

## Rejected alternatives

### Propagate every quality field

Rejected because endpoint throughput and latency vary by host. Copying them would make a fast route
appear equally fast on providers that were never measured.

### Do not propagate scores

Rejected because most providers would remain unscored even when a high-confidence canonical alias
shows that they offer the same underlying model. That would make quality-first comparisons depend
on where a score happened to be collected.

## Consequences

- Cross-provider intrinsic coverage grows without presenting canonical joins as direct evidence.
- Low-confidence aliases sacrifice coverage in favor of avoiding incorrect score attribution.
- Conflicting direct scores publish with the preferred (Artificial-Analysis-attributed) value and a
  notice, rather than aborting the run; correction still happens at the canonical alias or
  source-precedence layer, on the maintainer's own schedule rather than under publish-time pressure.
- A small number of AA-scored, OpenRouter-absent offerings remain unscored until they gain a
  canonical alias (see Decision).
