# ADR 0010: Rank delegation profiles on measured score, not metadata presence

Status: Accepted

This ADR revises ADR 0005. It removes the `fastest-coder` profile and reorders `best-free-coder`.

## Context

ADR 0005 defined five delegation profiles. Two of them do not behave as intended against the live catalog.

`fastest-coder` requires a non-null `speed_score`. Zero of 1163 published offerings carry one. No provider the feed integrates publishes a per-endpoint speed measurement, so the profile returns an empty set on every run. ADR 0005 already recorded this as a temporary state. It has not changed.

`best-free-coder` compares offerings in this order: availability, then a non-stale free claim, then pricing kind, then the `coding` capability, then `tool_use`, then `structured_output`, then `coding_score`.

Capability presence therefore outranks a measured score. On the 2026-07-25 feed the profile selected `cline:google/gemma-4-31b-it:free` at a coding score of 43.4. It rejected `opencode-zen:mimo-v2.5-free` at 56.8 and `opencode-zen:deepseek-v4-flash-free` at 56.2. Both are free, listed, and hold a fresh free claim.

The only difference is `structured_output`. Gemma carries the capability. The two OpenCode Zen offerings do not.

OpenCode Zen publishes a sparse roster. Its catalog reports almost no capability metadata. The two offerings were penalised for an unreported capability, not for a missing one.

The `coding` capability comparison is dead code. The profile's predicate already requires `coding`, so both sides always match.

## Decision

1. Remove the `fastest-coder` profile. Remove its predicate, its comparator, its selector, its export preset, and the `FASTEST_CODER_MIN_CODING_SCORE` constant. A profile that cannot return a result is worse than no profile: a consumer cannot tell an empty catalog from a broken feature.

2. Reorder `best-free-coder`. The new order is: availability, then a non-stale free claim, then pricing kind, then `coding_score`, then `tool_use`, then `structured_output`, then context window, then offering id.

3. Keep pricing kind above `coding_score`. The profile answers "the best coder that costs nothing". A `subscription_included` offering is not free unless the consumer already pays for the subscription. Without this rule the profile would select `cline-pass:cline-pass/kimi-k3` at 76.2, which needs a paid subscription.

4. Keep the non-stale free claim above `coding_score`. A stale free claim means the feed cannot confirm the offering is still free, which defeats the profile.

5. Delete the dead `coding` capability comparison.

6. Treat a missing capability flag as missing evidence, never as a negative signal, in every profile comparator. A capability flag may rank offerings only below the measured score it competes with.

7. Give `best-value-coder` a floor of `coding_score` 40. The profile divides a score by a blended price, so without a floor the cheapest barely-capable offering always wins. On the 2026-07-25 feed it selected an offering scoring 25.3. The floor makes the profile answer "the best value among models that can code". The value reuses the threshold ADR 0005 set for the removed `fastest-coder` profile rather than inventing a new one. Floors of 30, 40 and 50 select the same offering against the current catalog, so 40 is not fitted to today's data.

## Rejected alternatives

### Keep `fastest-coder` and publish an empty result

Rejected because a consumer reads an empty profile as "no model qualifies today". The real cause is a data source the feed does not have. Restore the profile when a provider publishes per-endpoint speed.

### Lower the coding-score floor so `fastest-coder` returns something

Rejected because the floor is not the blocker. `speed_score` is null on every offering, so no floor changes the result.

### Make `structured_output` and `tool_use` predicate requirements instead of tiebreakers

Rejected for `best-free-coder`, because it would drop every offering from a provider with a sparse catalog. The profile would then rank only the providers that publish rich metadata. `best-agentic` keeps its own capability requirements, because an agentic workflow genuinely needs them.

### Rank on `coding_score` before pricing kind

Rejected because the profile would return paid subscription offerings. Use `best-coder` for the highest score at any price.

## Consequences

- `best-free-coder` selects `opencode-zen:mimo-v2.5-free` at 56.8 rather than a 43.4-scoring offering.
- `best-value-coder` selects an offering scoring 58.8 rather than one scoring 25.3. Its candidate pool falls from 278 to 154.
- The feed publishes four delegation profiles rather than five.
- A `?profile=fastest-coder` request no longer resolves to a profile.
- A provider with a sparse capability catalog competes on measured quality.
