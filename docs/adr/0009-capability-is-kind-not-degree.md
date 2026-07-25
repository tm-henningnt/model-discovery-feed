# ADR 0009: A capability states kind, not degree

Status: Accepted

## Context

The feed derives the `coding` capability from a substring match on an offering's provider model ID, name, or description. The match keywords are "coder", "code", "coding", and "codex". Seven collectors each duplicate this logic. The Gemini collector has no coding logic.

Current results show a problem. 359 offerings carry a `quality.coding_score`. Of those, 263 offerings do not carry the `coding` capability. That is 73 percent.

The unflagged offerings include the highest-scoring coder in the feed, `anthropic/claude-opus-5-fast` at 78.0. They also include `gpt-5.6-sol`, `claude-fable-5`, and `claude-opus-4.8`.

Coverage per provider is uneven. Gemini flags 0 of 56 offerings. Groq flags 0 of 15. QwenCloud flags 9 of 250. OpenRouter flags 98 of 346.

The `best-free-coder` profile requires the `coding` capability. The feed's own recommendation is therefore drawn from a pool that a name heuristic defines. This heuristic excludes frontier models that score high on coding.

A quality score attaches during enrichment, after collection. A collector cannot read a score that does not exist yet. This means a collector cannot use coding scores to flag the `coding` capability.

## Decision

1. A capability states what kind of work an offering supports. A capability does not state how well the offering does that work. `quality.coding_score` states degree of ability. The two must not mix.

2. `coding` means the offering supports code generation.

3. The feed derives `coding` from a union of positive evidence. Any one of these is sufficient:
   - A `quality.coding_score` exists.
   - The model id, display name, or description matches a coding keyword.

   The keywords are "code", "coder", "coding", and "codex". Match them on word
   boundaries, not as substrings. A substring match also hits "encoder",
   "decoder", and "barcode", which flagged three audio and search models by
   mistake.

   models.dev exposes no code-capability field. Its model records carry
   `status`, `reasoning`, `tool_call`, `modalities`, and `structured_output`,
   but nothing that reports code support. No provider catalog exposes such a
   field either. This ADR therefore lists no metadata rule. Add one only when a
   source publishes the fact.

4. The offering must also carry the `chat` capability. This guard excludes no
   offering today. It stops an image, video, speech, or embedding model from
   gaining `coding` through a keyword in its description.

5. An offering with no evidence does not receive the capability. The feed does not claim what it cannot source. Approximately 693 chat-capable offerings have no coding measurement. They remain unflagged.

6. The derivation moves into the enrichment pipeline. The pipeline runs after quality scores attach. The per-collector keyword logic is removed.

7. Each derived capability records the rule that fired in the offering's source claim. A false positive stays auditable.

8. A consumer answers "which model is best at coding" by sorting on `quality.coding_score`, not by filtering on the capability.

## Rejected alternatives

### Flag `coding` only above a coding-score threshold

Rejected because it places a quality judgment in a capability field. The cutoff is arbitrary. About 805 offerings have no score, and the rule cannot state whether they are unqualified or unmeasured.

### Flag `coding` on every text chat model by default

Rejected because this flags approximately 1052 of 1164 offerings. The filter becomes a synonym for `chat` and stops discriminating.

### Derive `coding` from scores only, without the keyword rule

Rejected because 136 purpose-built coding models have no benchmark score. A model such as `qwen3-coder` loses the capability.

### Keep the narrow name heuristic and change only the downstream surfaces

Rejected because the capability field stays wrong. Every consumer that filters on it receives the same wrong answer.

## Consequences

- The count of offerings with the `coding` capability rises from 232 to 489.
- Consumers that filter on `coding` see approximately twice as many results. The results include frontier models that the filter excluded before.
- The `best-free-coder` profile selects from a correct pool. No change to the profile predicate is necessary.
- Coding scores already propagate across providers by canonical model. See ADR 0004. The capability propagates with them.
- QwenCloud derives a `policy.tags` entry from the `coding` capability. Those tags widen too.
