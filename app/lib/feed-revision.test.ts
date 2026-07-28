import { describe, expect, it } from "vitest";
import { isNewerRelease, parseFeedRevision, revisionKey } from "./feed-revision";

const shown = {
  generatedAt: "2026-07-28T08:00:00.000Z",
  sourceRevision: "collector-run-2026-07-28T08:00:00.000Z"
};

describe("parseFeedRevision", () => {
  it("reads the route payload", () => {
    expect(
      parseFeedRevision({
        generated_at: "2026-07-28T12:00:00.000Z",
        source_revision: "collector-run-2026-07-28T12:00:00.000Z"
      })
    ).toEqual({
      generatedAt: "2026-07-28T12:00:00.000Z",
      sourceRevision: "collector-run-2026-07-28T12:00:00.000Z"
    });
  });

  it("rejects a payload that is not an object", () => {
    expect(parseFeedRevision(null)).toBeNull();
    expect(parseFeedRevision("<!doctype html>")).toBeNull();
  });

  it("rejects a payload with a missing field", () => {
    expect(parseFeedRevision({ generated_at: "2026-07-28T12:00:00.000Z" })).toBeNull();
    expect(parseFeedRevision({ source_revision: "collector-run-1" })).toBeNull();
  });

  it("rejects an unparsable timestamp", () => {
    expect(parseFeedRevision({ generated_at: "yesterday", source_revision: "r" })).toBeNull();
  });
});

describe("revisionKey", () => {
  it("separates a republish of the same instant", () => {
    expect(revisionKey(shown)).not.toBe(
      revisionKey({ ...shown, sourceRevision: "manual-republish" })
    );
  });

  it("gives one release one key", () => {
    expect(revisionKey(shown)).toBe(revisionKey({ ...shown }));
  });
});

describe("isNewerRelease", () => {
  it("reports a later release", () => {
    expect(
      isNewerRelease(shown, {
        generatedAt: "2026-07-28T12:00:00.000Z",
        sourceRevision: "collector-run-2026-07-28T12:00:00.000Z"
      })
    ).toBe(true);
  });

  it("reports a republish of the same instant", () => {
    expect(
      isNewerRelease(shown, { generatedAt: shown.generatedAt, sourceRevision: "manual-republish" })
    ).toBe(true);
  });

  it("reports nothing for the release already shown", () => {
    expect(isNewerRelease(shown, { ...shown })).toBe(false);
  });

  // A replica can lag behind the writer. Announcing an older release would put
  // the notice up, and a refresh would then bring back the same view.
  it("reports nothing for an earlier release", () => {
    expect(
      isNewerRelease(shown, {
        generatedAt: "2026-07-28T04:00:00.000Z",
        sourceRevision: "collector-run-2026-07-28T04:00:00.000Z"
      })
    ).toBe(false);
  });

  it("reports nothing when a timestamp does not parse", () => {
    expect(isNewerRelease(shown, { generatedAt: "not-a-date", sourceRevision: "r" })).toBe(false);
    expect(isNewerRelease({ ...shown, generatedAt: "not-a-date" }, shown)).toBe(false);
  });
});
