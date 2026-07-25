import { claim, cleanCapabilityList, collectorNotice } from "../collectors/shared";
import type { CollectorNotice } from "../collectors/types";
import type { ModelOffering } from "../feed/schema";

export const DERIVE_CODING_CAPABILITY_COLLECTOR_ID = "derive-coding-capability";

// ADR 0009: a capability states kind, not degree. Word boundaries stop "encoder",
// "decoder", and "barcode" from matching "code" as a substring.
const CODING_KEYWORD_PATTERN = /\b(code|coder|coding|codex)\b/i;

type KeywordField = "provider_model_id" | "display_name" | "description";

type Evidence = { rule: "score" } | { rule: "keyword"; field: KeywordField; keyword: string };

function keywordMatch(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(CODING_KEYWORD_PATTERN);
  return match ? match[0].toLowerCase() : null;
}

function findEvidence(model: ModelOffering): Evidence | null {
  if (model.quality.coding_score !== null) {
    return { rule: "score" };
  }

  const fields: [KeywordField, string | null][] = [
    ["provider_model_id", model.provider_model_id],
    ["display_name", model.display_name],
    ["description", model.description]
  ];

  for (const [field, value] of fields) {
    const keyword = keywordMatch(value);
    if (keyword) {
      return { rule: "keyword", field, keyword };
    }
  }

  return null;
}

function withCodingTag(model: ModelOffering, present: boolean): ModelOffering {
  const tags = present
    ? Array.from(new Set([...model.policy.tags, "coding"]))
    : model.policy.tags.filter((tag) => tag !== "coding");

  if (tags.length === model.policy.tags.length && tags.every((tag, index) => tag === model.policy.tags[index])) {
    return model;
  }

  return { ...model, policy: { ...model.policy, tags } };
}

function withCodingCapability(model: ModelOffering, present: boolean): ModelOffering {
  const capabilities = present
    ? cleanCapabilityList([...model.capabilities, "coding"])
    : model.capabilities.filter((capability) => capability !== "coding");

  return withCodingTag({ ...model, capabilities }, present);
}

function provenanceClaim(model: ModelOffering, evidence: Evidence, observedAt: string) {
  return claim({
    id: `${DERIVE_CODING_CAPABILITY_COLLECTOR_ID}:${model.id}`,
    collector: DERIVE_CODING_CAPABILITY_COLLECTOR_ID,
    // The claim names the evidence, not the mechanism. A score comes from a
    // benchmark republished by a third party; a keyword comes from the text the
    // provider's own catalog publishes. `manual_override` is reserved for the
    // manual-overrides feature, so a derived capability must not borrow it.
    sourceType: evidence.rule === "score" ? "third_party_catalog" : "provider_api",
    sourceUrl: null,
    observedAt,
    fieldPaths: ["capabilities"],
    // Keyword evidence infers a capability from prose, so it is weaker than a
    // measured score.
    confidence: evidence.rule === "score" ? "high" : "medium",
    rawReference:
      evidence.rule === "score"
        ? { rule: "score", coding_score: model.quality.coding_score }
        : { rule: "keyword", field: evidence.field, keyword: evidence.keyword }
  });
}

export type DeriveCodingCapabilityResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
};

/**
 * Derives the `coding` capability per ADR 0009. An offering gains `coding`
 * when it carries `chat` AND has positive evidence: either a
 * `quality.coding_score`, or a word-boundary keyword match ("code", "coder",
 * "coding", "codex") on its own provider_model_id, display_name, or
 * description. This stage is authoritative: it also strips `coding` from an
 * offering that fails the rule, and it keeps `policy.tags` in step with the
 * capability either way.
 *
 * Runs last in the pipeline, after score propagation (see ADR 0004), so a
 * score propagated across canonical twins counts as evidence here too.
 */
export function deriveCodingCapability(models: ModelOffering[], observedAt: string): DeriveCodingCapabilityResult {
  let gained = 0;
  let lost = 0;

  const result = models.map((model) => {
    const hasChat = model.capabilities.includes("chat");
    const evidence = hasChat ? findEvidence(model) : null;
    const shouldHaveCoding = evidence !== null;
    const hasCoding = model.capabilities.includes("coding");

    if (shouldHaveCoding && !hasCoding) {
      gained += 1;
      const withCapability = withCodingCapability(model, true);
      return {
        ...withCapability,
        source_claims: [...withCapability.source_claims, provenanceClaim(model, evidence, observedAt)]
      };
    }

    if (!shouldHaveCoding && hasCoding) {
      lost += 1;
      return withCodingCapability(model, false);
    }

    // The capability is already correct; only resync a drifted tag (a
    // collector's own tag logic could disagree with its capability logic).
    return withCodingTag(model, hasCoding);
  });

  return {
    models: result,
    notices: [
      collectorNotice(DERIVE_CODING_CAPABILITY_COLLECTOR_ID, "derived coding capability per ADR 0009", {
        gained,
        lost
      })
    ]
  };
}
