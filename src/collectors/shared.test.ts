import { describe, expect, it } from "vitest";
import { accountFreeTierPricing, tokenPricing } from "./shared";

const OBSERVED_AT = "2026-08-01T00:00:00.000Z";

describe("tokenPricing", () => {
  it("reads a zero rate on a text-only offering as free", () => {
    const pricing = tokenPricing({
      prompt: "0",
      completion: "0",
      outputModalities: ["text"],
      observedAt: OBSERVED_AT
    });

    expect(pricing.kind).toBe("free");
    expect(pricing.input_usd_per_1m_tokens).toBe(0);
    expect(pricing.metering).toBe("tokens");
    expect(pricing.free).toMatchObject({
      is_currently_free: true,
      basis: "zero_priced_model",
      confidence: "high",
      last_verified_at: OBSERVED_AT
    });
  });

  it("assumes tokens are the meter when the provider declares no output modality", () => {
    const pricing = tokenPricing({ prompt: "0", completion: "0", observedAt: OBSERVED_AT });

    expect(pricing.kind).toBe("free");
    expect(pricing.metering).toBe("tokens");
  });

  it("lowers the free confidence when the caller cannot confirm the rate against the seller", () => {
    const pricing = tokenPricing({
      prompt: "0",
      completion: "0",
      observedAt: OBSERVED_AT,
      freeConfidence: "low"
    });

    expect(pricing.kind).toBe("free");
    expect(pricing.free?.confidence).toBe("low");
  });

  it("refuses a free claim when the offering is not metered in tokens", () => {
    // A music model publishes "0" per token because it bills per song.
    const pricing = tokenPricing({
      prompt: "0",
      completion: "0",
      outputModalities: ["text", "audio"],
      observedAt: OBSERVED_AT
    });

    expect(pricing.kind).toBe("unknown");
    expect(pricing.input_usd_per_1m_tokens).toBeNull();
    expect(pricing.output_usd_per_1m_tokens).toBeNull();
    expect(pricing.currency).toBeNull();
    expect(pricing.metering).toBeNull();
    expect(pricing.free).toBeNull();
  });

  it("keeps a real rate on an offering that is not metered in tokens", () => {
    const pricing = tokenPricing({
      prompt: "0.000002",
      completion: "0.000008",
      outputModalities: ["audio"],
      observedAt: OBSERVED_AT
    });

    expect(pricing.kind).toBe("paid");
    expect(pricing.input_usd_per_1m_tokens).toBeCloseTo(2, 6);
    expect(pricing.metering).toBe("tokens");
  });

  it("reports an unreadable rate as unknown rather than free", () => {
    const pricing = tokenPricing({ prompt: null, completion: "0", observedAt: OBSERVED_AT });

    expect(pricing.kind).toBe("unknown");
    expect(pricing.free).toBeNull();
  });

  it("converts a published per-token rate into USD per million tokens", () => {
    const pricing = tokenPricing({ prompt: "0.00000042", completion: "0.00000132", observedAt: OBSERVED_AT });

    expect(pricing.kind).toBe("paid");
    expect(pricing.input_usd_per_1m_tokens).toBeCloseTo(0.42, 6);
    expect(pricing.output_usd_per_1m_tokens).toBeCloseTo(1.32, 6);
    expect(pricing.currency).toBe("USD");
  });

  it("carries a provider expiration date onto the free claim", () => {
    const pricing = tokenPricing({
      prompt: "0",
      completion: "0",
      expiresAt: "2026-12-01T00:00:00Z",
      observedAt: OBSERVED_AT
    });

    expect(pricing.free?.expires_at).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("accountFreeTierPricing", () => {
  it("publishes the billed rate of zero and records the seller as the basis", () => {
    const pricing = accountFreeTierPricing(OBSERVED_AT);

    // `kind` stays "free" rather than "free_tier" so the offering satisfies isConfidentlyFree.
    expect(pricing.kind).toBe("free");
    expect(pricing.input_usd_per_1m_tokens).toBe(0);
    expect(pricing.output_usd_per_1m_tokens).toBe(0);
    expect(pricing.currency).toBe("USD");
    expect(pricing.free).toMatchObject({
      is_currently_free: true,
      basis: "account_free_tier",
      requires_account: true,
      requires_api_key: true,
      quota: null,
      confidence: "high"
    });
  });

  it("records a quota when the seller publishes one", () => {
    expect(accountFreeTierPricing(OBSERVED_AT, "5 requests per minute").free?.quota).toBe("5 requests per minute");
  });
});
