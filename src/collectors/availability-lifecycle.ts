import type { FeedDocument, ModelOffering } from "../feed/schema";
import { collectorNotice } from "./shared";
import type { CollectorNotice } from "./types";

// ADR 0008: an offering's availability state is derived from the previous
// published release, not from a new database table. This module holds that
// derivation so the publish path can stay a thin caller.

const RETIREMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MASS_LOSS_RATIO_THRESHOLD = 0.2;
const MASS_LOSS_MIN_COUNT = 3;
const FAILURE_NOTICE_PREFIX = "collector unavailable";

export type AvailabilityLifecycleResult = {
  models: ModelOffering[];
  notices: CollectorNotice[];
};

function isFailureNotice(notice: CollectorNotice, providerId: string): boolean {
  return (
    notice.collector === providerId &&
    typeof notice.message === "string" &&
    notice.message.startsWith(FAILURE_NOTICE_PREFIX)
  );
}

function nextAbsentStatus(previousStatus: ModelOffering["availability"]["status"]): "unknown" | "retired" {
  return previousStatus === "unknown" || previousStatus === "retired" ? "retired" : "unknown";
}

function isOlderThanRetentionWindow(lastSuccessAt: string | null, nowMs: number): boolean {
  if (!lastSuccessAt) return true;
  const lastSuccessMs = Date.parse(lastSuccessAt);
  if (!Number.isFinite(lastSuccessMs)) return true;
  return nowMs - lastSuccessMs > RETIREMENT_WINDOW_MS;
}

function carryForwardUnchanged(model: ModelOffering, nowIso: string): ModelOffering {
  return {
    ...model,
    availability: {
      ...model.availability,
      last_checked_at: nowIso
    }
  };
}

function carryForwardWithNextStatus(model: ModelOffering, nextStatus: "unknown" | "retired", nowIso: string): ModelOffering {
  return {
    ...model,
    availability: {
      ...model.availability,
      status: nextStatus,
      last_checked_at: nowIso
    },
    policy:
      nextStatus === "retired"
        ? { ...model.policy, visibility: "hidden" }
        : model.policy
  };
}

/**
 * Advances timestamps for an offering present in this run's catalog. Per ADR
 * 0008's status precedence rule, catalog presence only decides `unknown`
 * versus `retired` for an ABSENT offering — it never overrides a status a
 * collector or enrichment stage already assigned to a PRESENT one (for
 * example `deprecated` from a models.dev signal, or `retired` from a
 * provider-published expiration date in the past). Forcing `available` here
 * would silently erase that work. `policy.visibility` is restored to
 * `listed` for anything other than `retired`, since a present offering that
 * is not retired must not stay hidden from an earlier run.
 */
function advancePresentOffering(model: ModelOffering, nowIso: string): ModelOffering {
  const isRetired = model.availability.status === "retired";
  const nextVisibility = isRetired ? "hidden" : "listed";
  return {
    ...model,
    availability: {
      ...model.availability,
      last_checked_at: nowIso,
      last_success_at: nowIso
    },
    policy: model.policy.visibility === nextVisibility ? model.policy : { ...model.policy, visibility: nextVisibility }
  };
}

/**
 * Derives each offering's next availability state from the last published
 * release. Call this from the publish path only — the DB-less collect path
 * has no previous release and must pass `previousRelease: null`, which is a
 * pure passthrough with no tombstones and no notices.
 */
export function applyAvailabilityLifecycle(params: {
  previousRelease: FeedDocument | null;
  currentModels: ModelOffering[];
  notices: CollectorNotice[];
  now: Date;
  /**
   * Offerings an earlier stage removed on positive evidence of retirement, for
   * example a models.dev `deprecated` status. These did not merely fail to
   * appear, so they bypass both guards and retire at once instead of waiting a
   * run at `unknown`. Without this a deliberate bulk removal looks like an
   * implausible mass loss, trips guard 2, and republishes the dead offerings.
   */
  deliberatelyRetiredIds?: ReadonlySet<string>;
}): AvailabilityLifecycleResult {
  const { previousRelease, currentModels, notices, now } = params;
  const deliberatelyRetiredIds = params.deliberatelyRetiredIds ?? new Set<string>();

  if (!previousRelease) {
    return { models: currentModels, notices: [] };
  }

  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const currentById = new Map(currentModels.map((model) => [model.id, model] as const));
  const previousByProvider = new Map<string, ModelOffering[]>();
  for (const model of previousRelease.models) {
    const list = previousByProvider.get(model.provider.id) ?? [];
    list.push(model);
    previousByProvider.set(model.provider.id, list);
  }

  const failedProviderIds = new Set(
    [...previousByProvider.keys()].filter((providerId) =>
      notices.some((notice) => isFailureNotice(notice, providerId))
    )
  );

  const extraNotices: CollectorNotice[] = [];
  const carriedForward: ModelOffering[] = [];

  for (const [providerId, previousModels] of previousByProvider) {
    if (failedProviderIds.has(providerId)) {
      // Guard 1: the collector reported a fetch failure, so this run's data
      // for the provider is not trustworthy. Ignore it entirely and carry
      // every previous offering forward unchanged.
      for (const model of previousModels) {
        // The retention window is an absolute cap. Without it a permanently
        // broken collector would pin its whole roster at `available` forever,
        // because each run rebuilds the same baseline it just carried forward.
        if (isOlderThanRetentionWindow(model.availability.last_success_at, nowMs)) {
          continue;
        }
        carriedForward.push(carryForwardUnchanged(model, nowIso));
      }
      continue;
    }

    const allMissing = previousModels.filter((model) => !currentById.has(model.id));

    // An offering removed on positive evidence retires immediately and never
    // counts toward the mass-loss ratio.
    const deliberate = allMissing.filter((model) => deliberatelyRetiredIds.has(model.id));
    for (const model of deliberate) {
      if (isOlderThanRetentionWindow(model.availability.last_success_at, nowMs)) {
        continue;
      }
      carriedForward.push(carryForwardWithNextStatus(model, "retired", nowIso));
    }

    const missing = allMissing.filter((model) => !deliberatelyRetiredIds.has(model.id));
    if (missing.length === 0) continue;

    const lossRatio = missing.length / previousModels.length;
    const guardTripped = lossRatio > MASS_LOSS_RATIO_THRESHOLD && missing.length >= MASS_LOSS_MIN_COUNT;

    if (guardTripped) {
      extraNotices.push(
        collectorNotice(providerId, "availability diff skipped: implausible mass loss", {
          previous_offering_count: previousModels.length,
          missing_offering_count: missing.length,
          loss_ratio: lossRatio
        })
      );
      // Guard 2: skip the retirement diff for the missing subset only. The
      // offerings that did come back this run are genuine and are handled by
      // the present-offering pass below.
      for (const model of missing) {
        // Same absolute cap as guard 1. A real bulk retirement trips this
        // guard on every run, because carrying the roster forward recreates
        // the baseline that tripped it. Without the cap the guard would hold
        // dead offerings at `available` permanently. The window gives an
        // operator 7 days of daily notices to confirm the loss is genuine.
        if (isOlderThanRetentionWindow(model.availability.last_success_at, nowMs)) {
          continue;
        }
        carriedForward.push(carryForwardUnchanged(model, nowIso));
      }
      continue;
    }

    for (const model of missing) {
      if (isOlderThanRetentionWindow(model.availability.last_success_at, nowMs)) {
        continue;
      }

      const nextStatus = nextAbsentStatus(model.availability.status);
      carriedForward.push(carryForwardWithNextStatus(model, nextStatus, nowIso));
    }
  }

  const presentModels = currentModels
    .filter((model) => !failedProviderIds.has(model.provider.id))
    .map((model) => advancePresentOffering(model, nowIso));

  return {
    models: [...presentModels, ...carriedForward],
    notices: extraNotices
  };
}
