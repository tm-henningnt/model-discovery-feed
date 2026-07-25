import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { Capability, ModelOffering } from "../feed/schema";
import { PROPAGATE_CAPABILITIES_COLLECTOR_ID, propagateCapabilities } from "./propagate-capabilities";

const OBSERVED_AT = "2026-07-25T00:00:00.000Z";
const canonicalId = "poolside/laguna-s-2.1";

function offering(
  id: string,
  capabilities: Capability[],
  confidence: "high" | "medium" = "high"
): ModelOffering {
  const model = structuredClone(exampleFeed.models[0]);
  model.id = id;
  const providerId = id.slice(0, id.indexOf(":"));
  model.provider = { id: providerId, name: providerId };
  model.provider_model_id = id.slice(id.indexOf(":") + 1);
  model.capabilities = capabilities;
  model.policy = { visibility: "listed", tags: [], recommended_for_agentic_workflows: null };
  model.canonical_model = {
    id: canonicalId,
    confidence,
    knowledge_cutoff: null,
    release_date: null,
    open_weights: null
  };
  return model;
}

describe("propagateCapabilities", () => {
  it("propagates coding to a sibling that lacks it", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "coding"]);
    const sparse = offering("opencode-zen:laguna-s-2.1", ["chat"]);

    const result = propagateCapabilities([donor, sparse], OBSERVED_AT);
    const recipient = result.models.find((m) => m.id === sparse.id);

    expect(recipient?.capabilities).toContain("coding");
  });

  it("propagates vision to a sibling that lacks it", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "vision"]);
    const sparse = offering("opencode-zen:laguna-s-2.1", ["chat"]);

    const result = propagateCapabilities([donor, sparse], OBSERVED_AT);
    const recipient = result.models.find((m) => m.id === sparse.id);

    expect(recipient?.capabilities).toContain("vision");
  });

  it("propagates reasoning to a sibling that lacks it", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "reasoning"]);
    const sparse = offering("opencode-zen:laguna-s-2.1", ["chat"]);

    const result = propagateCapabilities([donor, sparse], OBSERVED_AT);
    const recipient = result.models.find((m) => m.id === sparse.id);

    expect(recipient?.capabilities).toContain("reasoning");
  });

  it("never propagates tool_use, streaming, or structured_output", () => {
    const donor = offering("openrouter:laguna-s-2.1", [
      "chat",
      "tool_use",
      "streaming",
      "structured_output"
    ]);
    const sparse = offering("opencode-zen:laguna-s-2.1", ["chat"]);

    const result = propagateCapabilities([donor, sparse], OBSERVED_AT);
    const recipient = result.models.find((m) => m.id === sparse.id);

    expect(recipient?.capabilities).not.toContain("tool_use");
    expect(recipient?.capabilities).not.toContain("streaming");
    expect(recipient?.capabilities).not.toContain("structured_output");
    expect(
      recipient?.source_claims.flatMap((c) => (c.raw_reference as { capability?: string } | null)?.capability ?? [])
    ).not.toEqual(expect.arrayContaining(["tool_use", "streaming", "structured_output"]));
  });

  it("does not propagate to an offering whose canonical confidence is not high", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "coding"]);
    const lowConfidence = offering("cline:laguna-s-2.1", ["chat"], "medium");

    const result = propagateCapabilities([donor, lowConfidence], OBSERVED_AT);
    const recipient = result.models.find((m) => m.id === lowConfidence.id);

    expect(recipient?.capabilities).not.toContain("coding");
    expect(recipient).toEqual(lowConfidence);
  });

  it("does not propagate to, and does not throw for, an offering with no canonical model", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "coding"]);
    const noCanonical = offering("cline:laguna-s-2.1", ["chat"]);
    noCanonical.canonical_model = null;

    let result: ReturnType<typeof propagateCapabilities> | undefined;
    expect(() => {
      result = propagateCapabilities([donor, noCanonical], OBSERVED_AT);
    }).not.toThrow();

    const recipient = result?.models.find((m) => m.id === noCanonical.id);
    expect(recipient?.capabilities).not.toContain("coding");
    expect(recipient).toEqual(noCanonical);
  });

  it("never removes a capability from any offering", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "coding"]);
    const alreadyHasMore = offering("cline:laguna-s-2.1", ["chat", "tool_use", "streaming"]);

    const result = propagateCapabilities([donor, alreadyHasMore], OBSERVED_AT);
    const recipient = result.models.find((m) => m.id === alreadyHasMore.id);

    expect(recipient?.capabilities).toEqual(expect.arrayContaining(["chat", "tool_use", "streaming", "coding"]));
  });

  it("adds the coding tag to policy.tags when it gains the coding capability", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "coding"]);
    const sparse = offering("opencode-zen:laguna-s-2.1", ["chat"]);

    const result = propagateCapabilities([donor, sparse], OBSERVED_AT);
    const recipient = result.models.find((m) => m.id === sparse.id);

    expect(recipient?.policy.tags).toContain("coding");
  });

  it("records a source claim naming the canonical model and the donor offering for each gained capability", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "coding", "vision"]);
    const sparse = offering("opencode-zen:laguna-s-2.1", ["chat"]);

    const result = propagateCapabilities([donor, sparse], OBSERVED_AT);
    const recipient = result.models.find((m) => m.id === sparse.id);
    const claims = recipient?.source_claims.filter((c) => c.collector === PROPAGATE_CAPABILITIES_COLLECTOR_ID);

    expect(claims).toHaveLength(2);
    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          confidence: "medium",
          field_paths: ["capabilities"],
          raw_reference: expect.objectContaining({
            canonical_model_id: canonicalId,
            donor_offering_id: donor.id,
            capability: "coding"
          })
        }),
        expect.objectContaining({
          confidence: "medium",
          field_paths: ["capabilities"],
          raw_reference: expect.objectContaining({
            canonical_model_id: canonicalId,
            donor_offering_id: donor.id,
            capability: "vision"
          })
        })
      ])
    );
  });

  it("produces no change and no claim when every sibling in a group already agrees", () => {
    const first = offering("openrouter:laguna-s-2.1", ["chat", "coding"]);
    const second = offering("cline:laguna-s-2.1", ["chat", "coding"]);

    const result = propagateCapabilities([first, second], OBSERVED_AT);

    expect(result.models).toEqual([first, second]);
    expect(
      result.models.flatMap((m) =>
        m.source_claims.filter((c) => c.collector === PROPAGATE_CAPABILITIES_COLLECTOR_ID)
      )
    ).toHaveLength(0);
  });

  it("emits a notice summarizing how many offerings gained each capability", () => {
    const donor = offering("openrouter:laguna-s-2.1", ["chat", "coding", "vision", "reasoning"]);
    const sparseOne = offering("opencode-zen:laguna-s-2.1", ["chat"]);
    const sparseTwo = offering("cline:laguna-s-2.1", ["chat"]);

    const result = propagateCapabilities([donor, sparseOne, sparseTwo], OBSERVED_AT);

    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: PROPAGATE_CAPABILITIES_COLLECTOR_ID,
        coding: 2,
        vision: 2,
        reasoning: 2
      })
    ]);
  });
});
