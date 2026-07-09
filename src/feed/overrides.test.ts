import { describe, expect, it } from "vitest";
import { exampleFeed } from "./fixture";
import { applyManualOverrides } from "./overrides";

describe("applyManualOverrides", () => {
  it("applies active visible overrides and appends a source claim", () => {
    const feed = applyManualOverrides(
      exampleFeed,
      [
        {
          targetFieldPath: "models.openrouter:qwen/qwen3-coder:free.policy.visibility",
          value: "hidden",
          reason: "temporarily broken",
          operator: "test",
          sourceUrl: "https://example.com/issue/1",
          visibleInSourceClaims: true,
          expiresAt: "2026-07-09T00:00:00.000Z",
          createdAt: "2026-07-08T12:00:00.000Z"
        }
      ],
      new Date("2026-07-08T13:00:00.000Z")
    );

    expect(feed.models[0].policy.visibility).toBe("hidden");
    expect(feed.models[0].source_claims.at(-1)).toMatchObject({
      source_type: "manual_override",
      source_url: "https://example.com/issue/1"
    });
  });

  it("ignores expired overrides", () => {
    const feed = applyManualOverrides(
      exampleFeed,
      [
        {
          targetFieldPath: "models.openrouter:qwen/qwen3-coder:free.policy.visibility",
          value: "hidden",
          reason: "expired",
          operator: "test",
          sourceUrl: null,
          visibleInSourceClaims: true,
          expiresAt: "2026-07-07T00:00:00.000Z",
          createdAt: "2026-07-06T12:00:00.000Z"
        }
      ],
      new Date("2026-07-08T13:00:00.000Z")
    );

    expect(feed.models[0].policy.visibility).toBe("listed");
  });
});
