import { claim, collectorNotice } from "../collectors/shared";
import type { CollectorNotice } from "../collectors/types";
import type { ModelOffering, SourceClaim } from "../feed/schema";

export const SCORE_PROPAGATION_COLLECTOR_ID = "score-propagation";

type IntrinsicFieldPath =
  | "quality.coding_score"
  | "quality.reasoning_score"
  | "quality.agentic_score"
  | "quality.benchmarks.math_score"
  | "quality.benchmarks.artificial_analysis"
  | "quality.benchmarks.design_arena";

type IntrinsicValue = number | Record<string, number> | NonNullable<
  NonNullable<ModelOffering["quality"]["benchmarks"]>["design_arena"]
>;

type Donor = {
  offering: ModelOffering;
  claim: SourceClaim;
  value: IntrinsicValue;
};

type IntrinsicField = {
  path: IntrinsicFieldPath;
  read(model: ModelOffering): IntrinsicValue | null;
  write(model: ModelOffering, value: IntrinsicValue): ModelOffering;
};

export type ScorePropagationResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
};

type DonorSelection = {
  donor: Donor;
  notice: CollectorNotice | null;
};

function withBenchmarks(
  model: ModelOffering,
  values: Partial<NonNullable<ModelOffering["quality"]["benchmarks"]>>
): ModelOffering {
  return {
    ...model,
    quality: {
      ...model.quality,
      benchmarks: {
        math_score: model.quality.benchmarks?.math_score ?? null,
        ttft_seconds: model.quality.benchmarks?.ttft_seconds ?? null,
        artificial_analysis: model.quality.benchmarks?.artificial_analysis ?? null,
        design_arena: model.quality.benchmarks?.design_arena ?? null,
        ...values
      }
    }
  };
}

const INTRINSIC_FIELDS: IntrinsicField[] = [
  {
    path: "quality.coding_score",
    read: (model) => model.quality.coding_score,
    write: (model, value) => ({
      ...model,
      quality: { ...model.quality, coding_score: value as number }
    })
  },
  {
    path: "quality.reasoning_score",
    read: (model) => model.quality.reasoning_score,
    write: (model, value) => ({
      ...model,
      quality: { ...model.quality, reasoning_score: value as number }
    })
  },
  {
    path: "quality.agentic_score",
    read: (model) => model.quality.agentic_score,
    write: (model, value) => ({
      ...model,
      quality: { ...model.quality, agentic_score: value as number }
    })
  },
  {
    path: "quality.benchmarks.math_score",
    read: (model) => model.quality.benchmarks?.math_score ?? null,
    write: (model, value) => withBenchmarks(model, { math_score: value as number })
  },
  {
    path: "quality.benchmarks.artificial_analysis",
    read: (model) => model.quality.benchmarks?.artificial_analysis ?? null,
    write: (model, value) =>
      withBenchmarks(model, { artificial_analysis: value as Record<string, number> })
  },
  {
    path: "quality.benchmarks.design_arena",
    read: (model) => model.quality.benchmarks?.design_arena ?? null,
    write: (model, value) =>
      withBenchmarks(model, {
        design_arena: value as NonNullable<
          NonNullable<ModelOffering["quality"]["benchmarks"]>["design_arena"]
        >
      })
  }
];

function isScoreOriginClaim(sourceClaim: SourceClaim): boolean {
  if (!sourceClaim.source_url) {
    return false;
  }

  try {
    const hostname = new URL(sourceClaim.source_url).hostname;
    return (
      hostname === "artificialanalysis.ai" ||
      hostname.endsWith(".artificialanalysis.ai") ||
      hostname === "designarena.ai" ||
      hostname.endsWith(".designarena.ai")
    );
  } catch {
    return false;
  }
}

function directClaim(model: ModelOffering, field: IntrinsicFieldPath): SourceClaim | null {
  return model.source_claims.find(
    (candidate) =>
      candidate.source_type === "third_party_catalog" &&
      candidate.confidence === "high" &&
      isScoreOriginClaim(candidate) &&
      candidate.field_paths.includes(field)
  ) ?? null;
}

function sameValue(left: IntrinsicValue, right: IntrinsicValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Per plan 031 item 1: when donors within a canonical group disagree, prefer
 * the Artificial-Analysis-sourced value and record the discrepancy as a
 * notice rather than aborting the run — a single conflicting pair must never
 * take down the whole publish pipeline.
 */
function selectDonor(
  models: ModelOffering[],
  canonicalId: string,
  field: IntrinsicField
): DonorSelection | null {
  const donors = models.flatMap((offering): Donor[] => {
    const value = field.read(offering);
    const sourceClaim = value === null ? null : directClaim(offering, field.path);
    return value !== null && sourceClaim ? [{ offering, claim: sourceClaim, value }] : [];
  });
  if (donors.length === 0) {
    return null;
  }

  const scoreOriginDonors = donors.filter((donor) => isScoreOriginClaim(donor.claim));
  // When multiple offerings tie as score-origin donors (e.g. an OpenRouter
  // base offering and its ":free" variant both carry the same AA or Design
  // Arena claim), prefer the base (non-variant) offering id so join
  // provenance doesn't depend on collector payload ordering. provider_model_id
  // (not the full "provider:id" offering id, which always has one colon)
  // carries the OpenRouter variant suffix, if any.
  const preferred =
    scoreOriginDonors.find((donor) => !donor.offering.provider_model_id.includes(":")) ??
    scoreOriginDonors[0] ??
    donors[0];
  const conflicting = donors.filter((donor) => !sameValue(donor.value, preferred.value));
  const notice =
    conflicting.length > 0
      ? collectorNotice(SCORE_PROPAGATION_COLLECTOR_ID, "conflicting direct intrinsic scores", {
          canonical_model_id: canonicalId,
          field_path: field.path,
          preferred_donor_offering_id: preferred.offering.id,
          conflicting_donor_offering_ids: conflicting.map((donor) => donor.offering.id)
        })
      : null;

  return { donor: preferred, notice };
}

function propagationClaim(
  recipient: ModelOffering,
  canonicalId: string,
  field: IntrinsicFieldPath,
  donor: Donor
): SourceClaim {
  return claim({
    id: `${SCORE_PROPAGATION_COLLECTOR_ID}:${recipient.id}:${field}`,
    collector: SCORE_PROPAGATION_COLLECTOR_ID,
    sourceType: "third_party_catalog",
    sourceUrl: donor.claim.source_url,
    observedAt: donor.claim.observed_at,
    fieldPaths: [field],
    confidence: "medium",
    rawReference: {
      canonical_model_id: canonicalId,
      donor_offering_id: donor.offering.id,
      donor_claim_id: donor.claim.id,
      donor_raw_reference: donor.claim.raw_reference
    }
  });
}

/**
 * Propagates model-intrinsic scores across high-confidence canonical joins.
 * Endpoint-specific speed and TTFT are deliberately absent from the field list.
 */
export function propagateScores(models: ModelOffering[]): ScorePropagationResult {
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
  const notices: CollectorNotice[] = [];

  for (const [canonicalId, members] of groups) {
    for (const field of INTRINSIC_FIELDS) {
      const selection = selectDonor(members, canonicalId, field);
      if (!selection) {
        continue;
      }
      if (selection.notice) {
        notices.push(selection.notice);
      }
      const donor = selection.donor;

      for (const original of members) {
        let recipient = enrichedById.get(original.id) ?? original;
        if (field.read(recipient) !== null) {
          continue;
        }

        recipient = field.write(recipient, structuredClone(donor.value));
        recipient = {
          ...recipient,
          source_claims: [
            ...recipient.source_claims,
            propagationClaim(recipient, canonicalId, field.path, donor)
          ]
        };
        enrichedById.set(original.id, recipient);
      }
    }
  }

  return {
    models: models.map((model) => enrichedById.get(model.id) ?? model),
    notices
  };
}
