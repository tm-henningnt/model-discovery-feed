import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Prisma 7 takes the connection through the PrismaClient constructor instead of
// the datasource block in the schema. The two options are mutually exclusive:
//
// - `accelerateUrl` for a Prisma Postgres or Accelerate pooled URL. Its scheme is
//   `prisma+postgres://` or `prisma://`. A driver adapter cannot read these,
//   because neither scheme is the Postgres wire protocol.
// - `adapter` for a direct Postgres connection, with scheme `postgres://` or
//   `postgresql://`.
//
// Production sets DATABASE_URL to the pooled Prisma Postgres URL, so it takes the
// first branch. A local or containerised Postgres takes the second.
export function isPooledPrismaUrl(url: string): boolean {
  return url.startsWith("prisma://") || url.startsWith("prisma+postgres://");
}

export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set.");
    }

    globalForPrisma.prisma = isPooledPrismaUrl(connectionString)
      ? new PrismaClient({ accelerateUrl: connectionString })
      : new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return globalForPrisma.prisma;
}
