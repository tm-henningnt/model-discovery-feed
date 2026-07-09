import { exampleFeed } from "@/feed/fixture";
import { validateFeedDocument } from "@/feed/schema";
import { readFile } from "node:fs/promises";
import { listRows } from "@/cli/list";

const feed = validateFeedDocument(exampleFeed);
const deterministicNow = new Date("2026-07-08T12:30:00.000Z");

const publicFixtures = [
  "valid-feed.json",
  "stale-free-feed.json",
  "encoded-id-feed.json",
  "adapter-output.example.json"
] as const;

for (const fixtureName of publicFixtures) {
  const fixture = JSON.parse(
    await readFile(new URL(`../docs/public/fixtures/${fixtureName}`, import.meta.url), "utf8")
  ) as unknown;

  if (fixtureName === "adapter-output.example.json") {
    validateAdapterOutputFixture(fixture);
    continue;
  }

  validateFeedDocument(fixture);
}

console.log(
  `Validated feed fixture ${feed.feed.id} with ${feed.models.length} model offerings and ${publicFixtures.length} public fixtures.`
);

function validateAdapterOutputFixture(fixture: unknown): void {
  const expected = listRows(feed, { free: true, capability: "coding" }, deterministicNow);

  if (JSON.stringify(fixture) !== JSON.stringify(expected)) {
    throw new Error("adapter-output.example.json does not match the CLI row contract for the example feed");
  }
}
