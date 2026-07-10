import { describe, expect, it } from "vitest";
import { exampleFeed } from "./fixture";
import { isConfidentlyFree, isFixtureSourceRevision } from "./classification";

describe("isConfidentlyFree", () => {
  const now = new Date("2026-07-08T12:30:00.000Z");

  it("returns true for a fresh free claim", () => {
    const model = structuredClone(exampleFeed.models[0]);
    expect(isConfidentlyFree(model, now)).toBe(true);
  });

  it("returns false when the free claim's last_verified_at is older than stale_after_seconds", () => {
    const model = structuredClone(exampleFeed.models[0]);
    model.pricing.free!.last_verified_at = "2026-07-06T12:00:00.000Z";
    expect(isConfidentlyFree(model, now)).toBe(false);
  });

  it("returns false for kind: paid", () => {
    const model = structuredClone(exampleFeed.models[0]);
    model.pricing.kind = "paid";
    expect(isConfidentlyFree(model, now)).toBe(false);
  });

  it("returns false when is_currently_free is false", () => {
    const model = structuredClone(exampleFeed.models[0]);
    model.pricing.free!.is_currently_free = false;
    expect(isConfidentlyFree(model, now)).toBe(false);
  });
});

describe("isFixtureSourceRevision", () => {
  it("returns true for a fixture-prefixed revision", () => {
    expect(isFixtureSourceRevision("fixture-2026-07-08T12:00:00.000Z")).toBe(true);
  });

  it("returns false for a collector-run-prefixed revision", () => {
    expect(isFixtureSourceRevision("collector-run-42")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isFixtureSourceRevision("")).toBe(false);
  });
});
