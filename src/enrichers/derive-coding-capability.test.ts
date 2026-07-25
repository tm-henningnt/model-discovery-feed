import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { ModelOffering } from "../feed/schema";
import { DERIVE_CODING_CAPABILITY_COLLECTOR_ID, deriveCodingCapability } from "./derive-coding-capability";

const OBSERVED_AT = "2026-07-25T00:00:00.000Z";

function baseOffering(overrides: Partial<ModelOffering> = {}): ModelOffering {
  const model = structuredClone(exampleFeed.models[1]);
  return {
    ...model,
    capabilities: ["chat", "streaming"],
    quality: { ...model.quality, coding_score: null },
    policy: { ...model.policy, tags: [] },
    ...overrides
  };
}

describe("deriveCodingCapability", () => {
  it("adds coding to a scored offering that has chat", () => {
    const model = baseOffering({
      id: "test:scored-chat",
      quality: { ...baseOffering().quality, coding_score: 78.0 }
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);

    expect(result.models[0].capabilities).toContain("coding");
    expect(result.models[0].policy.tags).toContain("coding");
  });

  it("adds coding to an unscored offering whose id matches a keyword", () => {
    const model = baseOffering({
      id: "test:id-keyword",
      provider_model_id: "acme-coder-7b",
      display_name: "Acme 7B",
      description: null
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);

    expect(result.models[0].capabilities).toContain("coding");
    expect(result.models[0].policy.tags).toContain("coding");
  });

  it("adds coding to an unscored offering whose description matches a keyword", () => {
    const model = baseOffering({
      id: "test:description-keyword",
      provider_model_id: "acme-7b",
      display_name: "Acme 7B",
      description: "A general model tuned for code generation."
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);

    expect(result.models[0].capabilities).toContain("coding");
  });

  it("does not add coding when the only match is 'decoder' (word-boundary proof)", () => {
    const model = baseOffering({
      id: "test:decoder-substring",
      provider_model_id: "gpt-audio-decoder",
      display_name: "Audio Decoder",
      description: "Encodes and decodes audio waveforms."
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);

    expect(result.models[0].capabilities).not.toContain("coding");
  });

  it("does not add coding when the only match is 'barcode' (word-boundary proof)", () => {
    const model = baseOffering({
      id: "test:barcode-substring",
      provider_model_id: "vision-barcode-reader",
      display_name: "Barcode Reader",
      description: "Reads a barcode from an image."
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);

    expect(result.models[0].capabilities).not.toContain("coding");
  });

  it("does not add coding when evidence exists but chat is absent", () => {
    const model = baseOffering({
      id: "test:no-chat",
      capabilities: ["streaming"],
      provider_model_id: "acme-coder-7b",
      quality: { ...baseOffering().quality, coding_score: 60 }
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);

    expect(result.models[0].capabilities).not.toContain("coding");
  });

  it("removes coding from an offering that carries it but has no evidence", () => {
    const model = baseOffering({
      id: "test:false-positive",
      capabilities: ["chat", "streaming", "coding"],
      provider_model_id: "gpt-audio",
      display_name: "GPT Audio",
      description: "Encodes and decodes audio.",
      policy: { visibility: "listed", tags: ["coding"], recommended_for_agentic_workflows: null }
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);

    expect(result.models[0].capabilities).not.toContain("coding");
    expect(result.models[0].policy.tags).not.toContain("coding");
  });

  it("keeps policy.tags in step with the capability in both directions", () => {
    const gains = baseOffering({ id: "test:tags-gain", provider_model_id: "acme-coder-7b" });
    const loses = baseOffering({
      id: "test:tags-lose",
      capabilities: ["chat", "streaming", "coding"],
      provider_model_id: "relace-search",
      description: "Searches a codebase index.",
      policy: { visibility: "listed", tags: ["coding"], recommended_for_agentic_workflows: null }
    });

    const result = deriveCodingCapability([gains, loses], OBSERVED_AT);
    const byId = new Map(result.models.map((model) => [model.id, model]));

    expect(byId.get("test:tags-gain")?.policy.tags).toContain("coding");
    expect(byId.get("test:tags-lose")?.policy.tags).not.toContain("coding");
  });

  it("records score-derived provenance in the source claim", () => {
    const model = baseOffering({
      id: "test:provenance-score",
      quality: { ...baseOffering().quality, coding_score: 78.0 }
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);
    const addedClaim = result.models[0].source_claims.find(
      (candidate) => candidate.collector === DERIVE_CODING_CAPABILITY_COLLECTOR_ID
    );

    expect(addedClaim).toMatchObject({
      collector: DERIVE_CODING_CAPABILITY_COLLECTOR_ID,
      field_paths: ["capabilities"],
      raw_reference: { rule: "score" }
    });
  });

  it("records keyword-derived provenance in the source claim", () => {
    const model = baseOffering({
      id: "test:provenance-keyword",
      provider_model_id: "acme-coder-7b"
    });

    const result = deriveCodingCapability([model], OBSERVED_AT);
    const addedClaim = result.models[0].source_claims.find(
      (candidate) => candidate.collector === DERIVE_CODING_CAPABILITY_COLLECTOR_ID
    );

    expect(addedClaim).toMatchObject({
      collector: DERIVE_CODING_CAPABILITY_COLLECTOR_ID,
      field_paths: ["capabilities"],
      raw_reference: { rule: "keyword", field: "provider_model_id", keyword: "coder" }
    });
  });

  it("emits a notice summarizing gains and losses", () => {
    const gains = baseOffering({ id: "test:notice-gain", provider_model_id: "acme-coder-7b" });
    const loses = baseOffering({
      id: "test:notice-lose",
      capabilities: ["chat", "streaming", "coding"],
      provider_model_id: "gpt-audio-mini",
      description: "A small audio decoder.",
      policy: { visibility: "listed", tags: ["coding"], recommended_for_agentic_workflows: null }
    });

    const result = deriveCodingCapability([gains, loses], OBSERVED_AT);

    expect(result.notices).toEqual([
      expect.objectContaining({
        collector: DERIVE_CODING_CAPABILITY_COLLECTOR_ID,
        gained: 1,
        lost: 1
      })
    ]);
  });
});
