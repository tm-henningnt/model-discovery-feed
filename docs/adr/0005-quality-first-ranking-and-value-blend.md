# ADR 0005: Rank Recommended by quality and use an input-weighted value blend

Status: Accepted

Formalizes `spec/spec-data-model-quality-scores.md`'s CON-005 (blend formula) and CON-006
(fastest-coder floor). See also: ADR 0002, whose verbatim-units decision is what makes these scores
safe to blend without a feed-owned normalization step; ADR 0004, whose propagated scores feed this
ranking for non-OpenRouter offerings.

## Context

The feed has quality scores, but a default ordering that prioritizes free access would make those
scores secondary. Delegating coding and agentic work is usually context-heavy: prompt and retained
context tokens dominate the bill more often than generated output tokens. A speed-oriented profile
also needs a quality floor so a fast but weak model is not selected for coding work.

## Decision

- The default Recommended ordering is availability, reasoning score, coding score, blended price,
  context window, then offering ID. Scores sort null-last, so an available scored offering precedes
  an otherwise-equal unscored offering.
- The accepted consequence is that unscored models sink under scored models at equal availability.
  This favors evidence-backed recommendations while preserving all offerings for direct filtering
  and search.
- Blended price per million tokens is `0.75 * input + 0.25 * output`. Confidently free offerings
  cost zero in this blend; an offering with either price unknown sorts after known prices.
- `fastest-coder` requires a coding score of at least 40 before sorting by endpoint speed. The
  exported `FASTEST_CODER_MIN_CODING_SCORE` constant is the canonical expression of that floor.
  A null speed score is ineligible, so the profile returns no selection when no endpoint measurement
  is available.

## Rejected alternatives

### Keep a free-first default

Rejected because the Recommended view should answer which available model is best, not which one is
free. `best-free-coder` remains available for that separate delegation goal.

### Have no default recommendation

Rejected because consumers need a deterministic, canonical ordering without copying ranking policy
into clients. The explorer and CLI can consume the shared feed ranking instead.

## Consequences

- Unscored specialty offerings may appear below scored alternatives until a quality source covers
  them; this is deliberate rather than an implicit claim that they are worse.
- Value comparisons reflect typical context-heavy agentic coding traffic instead of treating input
  and output tokens as equally likely.
- The current catalog has no per-endpoint speed measurements, so `fastest-coder` is empty in
  production until a source supplies that dimension. No fallback or relaxed null handling is used.
