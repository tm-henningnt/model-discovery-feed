# ADR 0001: Feed Publication State Machine

Status: Accepted

## Context

Provider collectors can fail independently, but clients need deterministic last-good feed reads. The hosted feed must therefore distinguish between raw collector output, validated materialization, and what the API is allowed to serve.

## Decision

- A collector run creates an unpublished candidate.
- A candidate may include partial provider updates only if every included provider result validates and the feed-level invariants validate.
- A candidate becomes a `published` `FeedRelease` only after full feed validation.
- Failed collectors are recorded in `CollectorRun` and surfaced in status/notices.
- The API serves the latest published release; it never serves an unpublished candidate.
- Fixture fallback is local/static mode only, not production DB mode.

## Consequences

- Stale but valid releases may be served when collectors fail.
- Status must show degraded health when collectors fail or the feed is stale.
- Raw snapshots are retained for audit and debugging.
- Fixture fallback remains local/static mode only, so production DB reads do not silently fall back to fixtures.
