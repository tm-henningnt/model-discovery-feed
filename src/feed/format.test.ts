import { describe, expect, it } from "vitest";
import { formatScore, formatSpeed, formatTokens, safeHttpUrl } from "./format";

describe("formatTokens", () => {
  const cases: [number | null | undefined, string][] = [
    [null, "—"],
    [undefined, "—"],
    [999, "999"],
    [1000, "1K"],
    [1500, "1.5K"],
    [1900, "1.9K"],
    [16384, "16K"],
    [131072, "131K"],
    [262144, "262K"],
    [1_000_000, "1M"],
    [1_500_000, "1.5M"]
  ];

  it.each(cases)("formats %p as %p", (input, expected) => {
    expect(formatTokens(input)).toBe(expected);
  });
});

describe("safeHttpUrl", () => {
  it("passes https URLs", () => {
    expect(safeHttpUrl("https://example.com")).toBe("https://example.com");
  });

  it("passes http URLs", () => {
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com");
  });

  it("rejects javascript: URLs", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects data: URLs", () => {
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(safeHttpUrl("not a url")).toBeNull();
  });

  it("rejects null/undefined", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe("quality score formatting", () => {
  it("preserves published score units and marks unavailable scores", () => {
    expect(formatScore(71.4)).toBe("71.4");
    expect(formatScore(null)).toBe("—");
  });

  it("adds the speed unit only for a known speed", () => {
    expect(formatSpeed(245)).toBe("245 t/s");
    expect(formatSpeed(null)).toBe("—");
  });
});
