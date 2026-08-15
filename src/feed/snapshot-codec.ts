import { gunzipSync, gzipSync } from "node:zlib";
import type { FeedDocument } from "./schema";

/**
 * A pooled Prisma Postgres connection rejects a query response above 5 MB. The
 * feed snapshot passed that size, so a release stores gzipped JSON in the
 * `snapshotGzip` column instead of raw JSON. Gzip makes the snapshot about 14
 * times smaller, which holds the read far below the limit.
 */
export function encodeFeedSnapshot(feed: FeedDocument): Uint8Array<ArrayBuffer> {
  // Prisma types a `Bytes` input as `Uint8Array<ArrayBuffer>`, and `gzipSync`
  // returns a `Buffer` over a pooled `ArrayBufferLike`. The copy gives the
  // exact type back.
  return new Uint8Array(gzipSync(Buffer.from(JSON.stringify(feed), "utf8")));
}

/** Reverses {@link encodeFeedSnapshot}. The result is unvalidated JSON. */
export function decodeFeedSnapshot(snapshot: Uint8Array): unknown {
  return JSON.parse(gunzipSync(snapshot).toString("utf8"));
}
