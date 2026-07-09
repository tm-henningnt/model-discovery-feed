import { describe, expect, it } from "vitest";
import { exampleFeed } from "./fixture";
import { filterProviders } from "./provider-filter";

describe("filterProviders", () => {
  it("filters providers by id, protocol, and query text", () => {
    expect(filterProviders(exampleFeed, { id: "openrouter" }).map((provider) => provider.id)).toEqual(["openrouter"]);
    expect(filterProviders(exampleFeed, { protocol: "openai_chat_completions" }).map((provider) => provider.id)).toEqual([
      "openrouter",
      "groq"
    ]);
    expect(filterProviders(exampleFeed, { q: "groq" }).map((provider) => provider.id)).toEqual(["groq"]);
  });
});
