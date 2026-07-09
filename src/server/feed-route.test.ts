import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exampleFeed } from "@/feed/fixture";
import { feedStore } from "@/feed/store";
import { GET } from "../../app/v1/feed/route";

describe("feed route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cache validators and a 304 on matching If-None-Match", async () => {
    vi.spyOn(feedStore, "getFeed").mockResolvedValue(exampleFeed);

    const firstResponse = await GET(new NextRequest("https://example.com/v1/feed"));

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("ETag")).toBeTruthy();
    expect(firstResponse.headers.get("Last-Modified")).toBe("Wed, 08 Jul 2026 12:00:00 GMT");
    expect(firstResponse.headers.get("Cache-Control")).toBe("private, max-age=300");

    const secondResponse = await GET(
      new NextRequest("https://example.com/v1/feed", {
        headers: {
          "If-None-Match": firstResponse.headers.get("ETag") ?? ""
        }
      })
    );

    expect(secondResponse.status).toBe(304);
    expect(secondResponse.headers.get("ETag")).toBe(firstResponse.headers.get("ETag"));
    expect(secondResponse.headers.get("Last-Modified")).toBe("Wed, 08 Jul 2026 12:00:00 GMT");
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(await secondResponse.text()).toBe("");
  });
});
