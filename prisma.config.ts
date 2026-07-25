import { defineConfig } from "prisma/config";

// Prisma 7 no longer accepts `url` on the datasource block in the schema file.
// Prisma Migrate reads the connection string from here. Prisma Client reads it
// through the driver adapter in src/server/prisma.ts.
//
// The datasource block is set only when DATABASE_URL is present, because
// `prisma generate` needs no database and both workflows run it without the
// variable. Prisma's own `env()` helper is not used: it throws while the config
// file loads, which breaks `prisma generate`. A migrate command with no
// DATABASE_URL still fails, with Prisma's missing-datasource error.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {})
});
