# ADR 0011: Propagate model-shaped capabilities across canonical joins

Status: Accepted

This ADR extends ADR 0004's propagation pattern to capabilities, and refines ADR 0009.

## Context

A downstream consumer reported that the same canonical model carries different capabilities at different providers. 335 canonical models are offered by more than one provider at high confidence. Across those, capabilities disagree between providers at these rates: `vision` 5, `coding` 14, `reasoning` 25, `tool_use` 24, `streaming` 22, `structured_output` 121.

`structured_output` disagrees on 121 of 335, far more than any other capability.

`poolside/laguna-s-2.1` is a worked example. Four offerings on `openrouter` and `cline` carry `coding`. The same canonical model on `opencode-zen` does not. No offering of it carries a `coding_score`, so the flag is not score-derived. One provider publishes the signal and another does not.

OpenCode Zen publishes a sparse roster with little capability metadata.

## Decision

1. Some capabilities describe the model. Others describe the endpoint. `coding`, `vision` and `reasoning` describe the model: the same weights can do the same kind of work at any provider. `tool_use`, `streaming` and `structured_output` describe the endpoint: one provider can expose function calling or server-sent events while another does not, for the same weights.

2. Propagate the model-shaped capabilities across every offering of a canonical model, where the canonical match confidence is `high`. If one offering carries `coding`, `vision` or `reasoning`, every sibling offering gains it.

3. Never propagate an endpoint-shaped capability. A difference in `tool_use`, `streaming` or `structured_output` between two providers is a fact, not a gap. The 121 disagreements on `structured_output` support this reading.

4. Propagation is additive. It never removes a capability from an offering.

5. Record a source claim on each offering that gains a capability. Name the canonical model and the donor offering, at confidence `medium`, the same confidence ADR 0004 gives a propagated score.

6. Propagation runs after the `coding` derivation of ADR 0009, so a derived flag propagates too. This refines ADR 0009: a confident canonical sibling's evidence counts as evidence for the whole canonical model, in the same way ADR 0004 treats a measured score.

## Rejected alternatives

### Propagate every capability

Rejected because an endpoint capability is genuinely provider-specific. Propagating `structured_output` would assert support that a provider does not offer, and a consumer would send a request the endpoint rejects.

### Propagate nothing and let each provider's catalog stand

Rejected because a sparse catalog then looks like a less capable model. A consumer filtering on `coding` misses the offering it should route to.

### Infer a missing capability from the model name or family

Rejected because that repeats the name-keyword mistake ADR 0009 removed. A sibling offering is a source; a name is a guess.

### Remove a capability when most siblings lack it

Rejected because absence is missing evidence, not a negative signal. A majority of sparse catalogs must not overrule one provider that publishes the fact.

## Consequences

- The `coding`, `vision` and `reasoning` capabilities become consistent across every offering of the same canonical model.
- `tool_use`, `streaming` and `structured_output` stay per offering, and can still differ between providers.
- A provider with a sparse catalog no longer under-reports what its models can do.
- The count of offerings carrying a model-shaped capability rises. A consumer that filters on `coding` sees more results.
- Propagation depends on the canonical match. An offering with a low-confidence or absent canonical model gains nothing.
