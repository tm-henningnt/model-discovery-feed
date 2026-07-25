import { claim, cleanCapabilityList, collectorNotice } from "../collectors/shared";
import type { CollectorNotice } from "../collectors/types";
import type { Capability, ModelOffering } from "../feed/schema";

export const PROPAGATE_CAPABILITIES_COLLECTOR_ID = "propagate-capabilities";

/**
 * Per ADR 0011: `coding`, `vision`, and `reasoning` describe the model, not
 * the endpoint — the same weights do the same kind of work at any provider.
 * `tool_use`, `streaming`, and `structured_output` describe the endpoint and
 * must never appear here.
 */
const MODEL_SHAPED_CAPABILITIES: Capability[] = ["coding", "vision", "reasoning"];

function withCapability(model: ModelOffering, capability: Capability): ModelOffering {
  return { ...model, capabilities: cleanCapabilityList([...model.capabilities, capability]) };
}

function withCodingTagIfNeeded(model: ModelOffering, capability: Capability): ModelOffering {
  if (capability !== "coding" || model.policy.tags.includes("coding")) {
    return model;
  }
  return { ...model, policy: { ...model.policy, tags: [...model.policy.tags, "coding"] } };
}

function propagationClaim(
  recipient: ModelOffering,
  canonicalId: string,
  capability: Capability,
  donor: ModelOffering,
  observedAt: string
) {
  return claim({
    id: `${PROPAGATE_CAPABILITIES_COLLECTOR_ID}:${recipient.id}:${capability}`,
    collector: PROPAGATE_CAPABILITIES_COLLECTOR_ID,
    sourceType: "third_party_catalog",
    sourceUrl: null,
    observedAt,
    fieldPaths: ["capabilities"],
    confidence: "medium",
    rawReference: {
      canonical_model_id: canonicalId,
      donor_offering_id: donor.id,
      capability
    }
  });
}

export type PropagateCapabilitiesResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
};

/**
 * Propagates model-shaped capabilities (`coding`, `vision`, `reasoning`)
 * across every offering of the same canonical model, where the canonical
 * match confidence is `high` (ADR 0011). If one offering in a canonical group
 * carries a model-shaped capability, every sibling offering gains it too.
 * Endpoint-shaped capabilities (`tool_use`, `streaming`, `structured_output`)
 * are never propagated — a provider can genuinely lack them for the same
 * weights another provider exposes.
 *
 * Additive only: this stage never removes a capability. Runs last in the
 * pipeline, after `deriveCodingCapability`, so a derived `coding` capability
 * counts as evidence for the whole canonical group too.
 */
export function propagateCapabilities(models: ModelOffering[], observedAt: string): PropagateCapabilitiesResult {
  const groups = new Map<string, ModelOffering[]>();
  for (const model of models) {
    if (model.canonical_model?.confidence !== "high") {
      continue;
    }
    const members = groups.get(model.canonical_model.id) ?? [];
    members.push(model);
    groups.set(model.canonical_model.id, members);
  }

  const enrichedById = new Map<string, ModelOffering>();
  const gainedByCapability = new Map<Capability, number>();

  for (const [canonicalId, members] of groups) {
    for (const capability of MODEL_SHAPED_CAPABILITIES) {
      const donor = members.find((member) => member.capabilities.includes(capability));
      if (!donor) {
        continue;
      }

      for (const original of members) {
        if (original.id === donor.id) {
          continue;
        }
        const current = enrichedById.get(original.id) ?? original;
        if (current.capabilities.includes(capability)) {
          continue;
        }

        let recipient = withCapability(current, capability);
        recipient = withCodingTagIfNeeded(recipient, capability);
        recipient = {
          ...recipient,
          source_claims: [
            ...recipient.source_claims,
            propagationClaim(recipient, canonicalId, capability, donor, observedAt)
          ]
        };

        enrichedById.set(original.id, recipient);
        gainedByCapability.set(capability, (gainedByCapability.get(capability) ?? 0) + 1);
      }
    }
  }

  return {
    models: models.map((model) => enrichedById.get(model.id) ?? model),
    notices: [
      collectorNotice(
        PROPAGATE_CAPABILITIES_COLLECTOR_ID,
        "propagated model-shaped capabilities across canonical joins per ADR 0011",
        {
          coding: gainedByCapability.get("coding") ?? 0,
          vision: gainedByCapability.get("vision") ?? 0,
          reasoning: gainedByCapability.get("reasoning") ?? 0
        }
      )
    ]
  };
}
