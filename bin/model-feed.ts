#!/usr/bin/env -S node --import tsx
import { listModels, parseCliArgs, USAGE } from "../src/cli/list";

async function main() {
  const invocation = parseCliArgs(process.argv.slice(2));

  switch (invocation.kind) {
    case "help":
      console.log(USAGE);
      return;
    case "error":
      throw new Error(invocation.message);
    case "list": {
      const rows = await listModels(invocation.options);
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    default: {
      const unexpected: never = invocation;
      return unexpected;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
