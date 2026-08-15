# ADR 0014: Store the release snapshot gzipped

Status: Accepted

See also: ADR 0001 (publication state machine, which writes the release row) and ADR 0008
(availability semantics, whose retirement diff reads the last published release).

## Context

Production connects through a pooled Prisma Postgres URL. A pooled connection rejects a query
response above 5 MB. The feed snapshot passed that size, and both reads of `FeedRelease` failed:

- `latestPublishedRelease` in `src/collectors/publish.ts`, which reads the retirement baseline. The
  refresh job crashed before it wrote a release, so no new feed was published.
- `OptionalPrismaFeedStore.getFeed` in `src/feed/store.ts`, which serves `/v1/feed`.

The snapshot is one JSON document per release. Source claims hold about half of its bytes, and the
document is read whole by both callers, so a narrower selection set does not help.

## Decision

- **A release stores its snapshot as gzipped JSON in `FeedRelease.snapshotGzip`.** Gzip makes the
  document about 14 times smaller, which holds the read far below the 5 MB limit and gives room for
  the catalog to keep growing. `src/feed/snapshot-codec.ts` holds the encode and decode pair, so
  both the write and the two reads use one format.
- **`FeedRelease.snapshotJson` is nullable and is no longer written.** It keeps the raw JSON of the
  releases written before this change.
- **A read takes the newest release that has a `snapshotGzip`.** A release without one cannot be read
  over a pooled connection, so the query filters it out rather than failing on it.
- **`getRevision` applies the same filter as `getFeed`.** Both reads must answer for the same
  release. Without the filter the site reports a release that the feed endpoint cannot serve.

## Rejected alternatives

### Raise the response size limit

The limit is configurable in the Prisma Postgres console. Rejected as the only measure: it needs a
console change that this repo cannot hold, and it buys one step of headroom against a document that
grows with every provider. Raising it stays available as an operator action.

### Trim the snapshot

Source claims are the largest part of the document, and dropping them would fit the limit today.
Rejected because the claims are the provenance record that the contract publishes. Compression costs
no field.

### Backfill the existing releases into `snapshotGzip`

Rejected because a backfill must first read the rows it converts, and those rows are exactly the ones
above the limit.

## Consequences

- The first refresh run after this change finds no readable baseline and publishes without a
  retirement diff. ADR 0008 already handles the no-baseline case as a passthrough: offerings absent
  from that run are dropped instead of carried forward as tombstones. The run after it has a
  baseline again.
- A release row is about 300 KB instead of about 4 MB, so the publish write shrinks as well.
- The snapshot is no longer queryable in SQL. Nothing queried into it, and ADR 0012 records that the
  feed is read as a document.
