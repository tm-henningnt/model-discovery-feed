import { describe, expect, it } from "vitest";
import { exampleFeed } from "../feed/fixture";
import type { FeedDocument, ModelOffering } from "../feed/schema";
import { applyAvailabilityLifecycle } from "./availability-lifecycle";
import type { CollectorNotice } from "./types";

const NOW = new Date("2026-07-25T03:17:00.000Z");

function offering(overrides: Partial<ModelOffering> & { id: string; providerId: string }): ModelOffering {
  const base = structuredClone(exampleFeed.models[0]);
  const { providerId, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    id: overrides.id,
    provider: { id: providerId, name: providerId },
    availability: {
      ...base.availability,
      ...rest.availability
    },
    policy: {
      ...base.policy,
      ...rest.policy
    }
  };
}

function previousFeed(models: ModelOffering[]): FeedDocument {
  return {
    ...structuredClone(exampleFeed),
    models
  };
}

describe("applyAvailabilityLifecycle", () => {
  it("is a pure passthrough with no notices when there is no previous release (DB-less path)", () => {
    const currentModels = [offering({ id: "openrouter:a", providerId: "openrouter" })];

    const result = applyAvailabilityLifecycle({
      previousRelease: null,
      currentModels,
      notices: [],
      now: NOW
    });

    expect(result.models).toBe(currentModels);
    expect(result.notices).toEqual([]);
  });

  it("marks a present offering available and advances last_success_at", () => {
    const previous = previousFeed([
      offering({
        id: "openrouter:a",
        providerId: "openrouter",
        availability: { status: "available", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-24T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    ]);
    const current = [
      offering({
        id: "openrouter:a",
        providerId: "openrouter",
        availability: { status: "available", last_checked_at: "2026-07-25T03:17:00.000Z", last_success_at: "2026-07-25T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    ];

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: current, notices: [], now: NOW });

    const model = result.models.find((m) => m.id === "openrouter:a");
    expect(model?.availability.status).toBe("available");
    expect(model?.availability.last_success_at).toBe(NOW.toISOString());
    expect(model?.availability.last_checked_at).toBe(NOW.toISOString());
  });

  it("keeps a present offering's deprecated status instead of forcing it back to available", () => {
    // Hazard regression: a present offering carries a status this run's
    // collector/enrichment stages assigned (e.g. a models.dev or expiration
    // deprecation signal). The lifecycle must not overwrite it with
    // `available` just because the offering is present in the catalog.
    const previous = previousFeed([
      offering({
        id: "openrouter:dep",
        providerId: "openrouter",
        availability: { status: "available", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-24T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    ]);
    const current = [
      offering({
        id: "openrouter:dep",
        providerId: "openrouter",
        availability: { status: "deprecated", last_checked_at: "2026-07-25T03:17:00.000Z", last_success_at: "2026-07-25T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    ];

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: current, notices: [], now: NOW });

    const model = result.models.find((m) => m.id === "openrouter:dep");
    expect(model?.availability.status).toBe("deprecated");
    expect(model?.availability.last_success_at).toBe(NOW.toISOString());
    expect(model?.availability.last_checked_at).toBe(NOW.toISOString());
    expect(model?.policy.visibility).toBe("listed");
  });

  it("moves an offering absent once from available to unknown, carried forward with a frozen last_success_at", () => {
    const previous = previousFeed([
      offering({
        id: "openrouter:gone",
        providerId: "openrouter",
        availability: { status: "available", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-24T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    ]);

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: [], notices: [], now: NOW });

    const model = result.models.find((m) => m.id === "openrouter:gone");
    expect(model).toBeDefined();
    expect(model?.availability.status).toBe("unknown");
    expect(model?.availability.last_success_at).toBe("2026-07-24T03:17:00.000Z");
    expect(model?.availability.last_checked_at).toBe(NOW.toISOString());
    expect(model?.policy.visibility).toBe("listed");
  });

  it("moves an offering absent again from unknown to retired and hides it", () => {
    const previous = previousFeed([
      offering({
        id: "openrouter:gone",
        providerId: "openrouter",
        availability: { status: "unknown", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-23T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    ]);

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: [], notices: [], now: NOW });

    const model = result.models.find((m) => m.id === "openrouter:gone");
    expect(model?.availability.status).toBe("retired");
    expect(model?.policy.visibility).toBe("hidden");
    expect(model?.availability.last_success_at).toBe("2026-07-23T03:17:00.000Z");
  });

  it("drops an offering whose last_success_at is more than 7 days before the run", () => {
    const previous = previousFeed([
      offering({
        id: "openrouter:stale",
        providerId: "openrouter",
        availability: { status: "retired", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-17T03:16:00.000Z", stale_after_seconds: 86400 }
      })
    ]);

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: [], notices: [], now: NOW });

    expect(result.models.find((m) => m.id === "openrouter:stale")).toBeUndefined();
  });

  it("guard 1: a provider failure notice carries every previous offering forward unchanged with no retirements", () => {
    const previous = previousFeed([
      offering({
        id: "gemini:a",
        providerId: "gemini",
        availability: { status: "available", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-24T03:17:00.000Z", stale_after_seconds: 86400 }
      }),
      offering({
        id: "gemini:b",
        providerId: "gemini",
        availability: { status: "unknown", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-23T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    ]);
    const notices: CollectorNotice[] = [
      { collector: "gemini", message: "collector unavailable or returned no models" }
    ];

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: [], notices, now: NOW });

    expect(result.models).toHaveLength(2);
    expect(result.models.find((m) => m.id === "gemini:a")?.availability.status).toBe("available");
    expect(result.models.find((m) => m.id === "gemini:b")?.availability.status).toBe("unknown");
    expect(result.models.every((m) => m.availability.last_checked_at === NOW.toISOString())).toBe(true);
    expect(result.notices).toEqual([]);
  });

  it("guard 2: an 11-offering roster that loses 4 trips the guard, publishes no retirements, and emits a notice", () => {
    const previousModels = Array.from({ length: 11 }, (_, index) =>
      offering({
        id: `openrouter:model-${index}`,
        providerId: "openrouter",
        availability: { status: "available", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-24T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    );
    const previous = previousFeed(previousModels);
    // Keep 7, lose 4 (36% loss, count 4 -> trips: >20% AND >=3).
    const current = previousModels.slice(0, 7).map((model) =>
      offering({ id: model.id, providerId: "openrouter" })
    );

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: current, notices: [], now: NOW });

    const retired = result.models.filter((m) => m.availability.status === "retired" || m.availability.status === "unknown");
    expect(retired).toHaveLength(0);
    expect(result.models).toHaveLength(11);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]?.collector).toBe("openrouter");
    expect(result.notices[0]?.message).toMatch(/mass loss/);
  });

  it("guard 2: a 346-offering roster that loses 5 does not trip; those 5 become unknown", () => {
    const previousModels = Array.from({ length: 346 }, (_, index) =>
      offering({
        id: `openrouter:model-${index}`,
        providerId: "openrouter",
        availability: { status: "available", last_checked_at: "2026-07-24T03:17:00.000Z", last_success_at: "2026-07-24T03:17:00.000Z", stale_after_seconds: 86400 }
      })
    );
    const previous = previousFeed(previousModels);
    const current = previousModels.slice(0, 341).map((model) => offering({ id: model.id, providerId: "openrouter" }));

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: current, notices: [], now: NOW });

    expect(result.notices).toEqual([]);
    const unknownIds = previousModels.slice(341).map((m) => m.id);
    for (const id of unknownIds) {
      expect(result.models.find((m) => m.id === id)?.availability.status).toBe("unknown");
    }
  });

  it("drops guard-2 held offerings once they exceed the retention window", () => {
    // A genuine bulk retirement trips guard 2 on every run, because carrying
    // the roster forward recreates the baseline that tripped it. The retention
    // window is what stops that from holding dead offerings forever.
    const stale = "2026-07-17T03:17:00.000Z"; // 8 days before NOW
    const fresh = "2026-07-24T03:17:00.000Z";
    const previous = previousFeed([
      offering({ id: "p:keep", providerId: "p" }),
      ...Array.from({ length: 4 }, (_, i) =>
        offering({
          id: `p:gone-${i}`,
          providerId: "p",
          availability: { status: "available", last_checked_at: fresh, last_success_at: stale, stale_after_seconds: 86400 }
        })
      ),
      ...Array.from({ length: 6 }, (_, i) => offering({ id: `p:other-${i}`, providerId: "p" }))
    ]);
    const currentModels = [
      offering({ id: "p:keep", providerId: "p" }),
      ...Array.from({ length: 6 }, (_, i) => offering({ id: `p:other-${i}`, providerId: "p" }))
    ];

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels, notices: [], now: NOW });

    // 4 of 11 missing trips guard 2, but all four exceeded the window.
    expect(result.notices.some((n) => String(n.message).includes("implausible mass loss"))).toBe(true);
    expect(result.models.filter((m) => m.id.startsWith("p:gone-"))).toHaveLength(0);
  });

  it("drops guard-1 held offerings once they exceed the retention window", () => {
    // A permanently broken collector must not pin its roster at `available`.
    const stale = "2026-07-10T03:17:00.000Z";
    const previous = previousFeed([
      offering({
        id: "groq:dead",
        providerId: "groq",
        availability: { status: "available", last_checked_at: stale, last_success_at: stale, stale_after_seconds: 86400 }
      }),
      offering({
        id: "groq:recent",
        providerId: "groq",
        availability: {
          status: "available",
          last_checked_at: "2026-07-24T03:17:00.000Z",
          last_success_at: "2026-07-24T03:17:00.000Z",
          stale_after_seconds: 86400
        }
      })
    ]);
    const notices: CollectorNotice[] = [{ collector: "groq", message: "collector unavailable", status: 503 }];

    const result = applyAvailabilityLifecycle({ previousRelease: previous, currentModels: [], notices, now: NOW });

    expect(result.models.map((m) => m.id)).not.toContain("groq:dead");
    expect(result.models.map((m) => m.id)).toContain("groq:recent");
  });

  it("retires deliberately removed offerings at once without tripping guard 2", () => {
    // The exact first-run-after-deploy scenario: the retire stage drops the 7
    // OpenCode Go ids models.dev marks retired, so 7 of 23 vanish. That is a
    // 30% loss and would trip guard 2, republishing the dead models for a week.
    const previous = previousFeed([
      ...Array.from({ length: 16 }, (_, i) => offering({ id: `opencode-go:live-${i}`, providerId: "opencode-go" })),
      ...Array.from({ length: 7 }, (_, i) =>
        offering({
          id: `opencode-go:dead-${i}`,
          providerId: "opencode-go",
          availability: {
            status: "available",
            last_checked_at: "2026-07-24T03:17:00.000Z",
            last_success_at: "2026-07-24T03:17:00.000Z",
            stale_after_seconds: 86400
          }
        })
      )
    ]);
    const currentModels = Array.from({ length: 16 }, (_, i) =>
      offering({ id: `opencode-go:live-${i}`, providerId: "opencode-go" })
    );
    const deliberatelyRetiredIds = new Set(
      Array.from({ length: 7 }, (_, i) => `opencode-go:dead-${i}`)
    );

    const result = applyAvailabilityLifecycle({
      previousRelease: previous,
      currentModels,
      notices: [],
      now: NOW,
      deliberatelyRetiredIds
    });

    expect(result.notices.some((n) => String(n.message).includes("implausible mass loss"))).toBe(false);
    const dead = result.models.filter((m) => m.id.startsWith("opencode-go:dead-"));
    expect(dead).toHaveLength(7);
    for (const model of dead) {
      expect(model.availability.status).toBe("retired");
      expect(model.policy.visibility).toBe("hidden");
    }
  });
});
