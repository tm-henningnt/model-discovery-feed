import { describe, expect, it } from "vitest";
import { exampleFeed } from "./fixture";
import { decodeFeedSnapshot, encodeFeedSnapshot } from "./snapshot-codec";

describe("feed snapshot codec", () => {
  it("returns the same document after a round trip", () => {
    expect(decodeFeedSnapshot(encodeFeedSnapshot(exampleFeed))).toEqual(exampleFeed);
  });

  it("makes the stored snapshot smaller than the raw JSON", () => {
    const raw = Buffer.byteLength(JSON.stringify(exampleFeed), "utf8");
    expect(encodeFeedSnapshot(exampleFeed).byteLength).toBeLessThan(raw);
  });
});
