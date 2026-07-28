import type { FeedRevision } from "@/feed/store";

export type { FeedRevision };

export const FEED_REVISION_PATH = "/api/feed-revision";

/** A stable identity for one release, for comparison and for React keys. */
export function revisionKey(revision: FeedRevision): string {
  return `${revision.generatedAt}|${revision.sourceRevision}`;
}

/**
 * Read a revision from a `GET /api/feed-revision` body.
 *
 * The probe runs in a browser, where a reply can also be a login page or an
 * error document. An unexpected shape returns null, and the caller then keeps
 * the revision it already has.
 */
export function parseFeedRevision(payload: unknown): FeedRevision | null {
  if (typeof payload !== "object" || payload === null) return null;

  const { generated_at: generatedAt, source_revision: sourceRevision } = payload as Record<
    string,
    unknown
  >;
  if (typeof generatedAt !== "string" || typeof sourceRevision !== "string") return null;
  if (Number.isNaN(new Date(generatedAt).getTime())) return null;

  return { generatedAt, sourceRevision };
}

/**
 * Test whether `candidate` is a release the reader does not have yet.
 *
 * A later `generated_at` is a new release. An equal `generated_at` with a
 * different `source_revision` is a republish of the same instant, which is also
 * new. An earlier `generated_at` is not new. A database replica can serve an
 * older release for a short time, and an announcement for that would flap.
 */
export function isNewerRelease(shown: FeedRevision, candidate: FeedRevision): boolean {
  const shownAt = new Date(shown.generatedAt).getTime();
  const candidateAt = new Date(candidate.generatedAt).getTime();
  if (Number.isNaN(shownAt) || Number.isNaN(candidateAt)) return false;

  if (candidateAt > shownAt) return true;
  return candidateAt === shownAt && candidate.sourceRevision !== shown.sourceRevision;
}
