# ADR 0002: Store third-party scores verbatim with documented units

Status: Accepted

Formalizes `spec/spec-data-model-quality-scores.md`'s CON-001. See also: ADR 0005, whose blend
formula (CON-005) treats these verbatim units as its input.

## Context

The feed publishes quality and performance measurements from third-party sources. Consumers need to
audit those values against their sources and distinguish aggregate indexes from endpoint-specific
measurements.

## Decision

- Store third-party scores exactly as published, without normalization, blending, or invented scales.
- Document units in the Zod schema and published JSON Schema: Artificial Analysis indexes are 0–100,
  `speed_score` is tokens/sec, and `ttft_seconds` is seconds.
- Preserve source-specific benchmark keys and Design Arena ratings verbatim in `quality.benchmarks`.

## Rejected alternatives

### Normalize every score to 0–100

Rejected because a catalog-relative normalization would change as the catalog changes and make a
stored value impossible to re-derive from its source. It would also erase the absolute unit of
endpoint throughput.

### Convert scores to fixed anchors

Rejected because fixed anchors would introduce feed-owner assumptions and stale calibration. The
source's published scale is the only stable, auditable representation.

## Consequences

- Consumers compare values only with knowledge of their documented source units.
- The feed can add source detail without changing the three existing headline quality fields.
- Source claims and attribution remain necessary so consumers can inspect provenance and licensing.
