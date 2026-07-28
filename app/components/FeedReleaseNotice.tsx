"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatRelativeTime } from "../lib/format";
import { revisionKey } from "../lib/feed-revision";
import { useNewerFeedRelease } from "./use-feed-revision";
import styles from "./FeedReleaseNotice.module.css";

type Props = {
  /** `feed.generated_at` of the release this page rendered from. */
  generatedAt: string;
  /** `feed.source_revision` of the release this page rendered from. */
  sourceRevision: string;
  /** Probe interval in milliseconds. Tests and stories set it; pages do not. */
  probeIntervalMs?: number;
};

/**
 * Tell the reader that a collector run published a new release, and offer to
 * re-render the current view from it.
 *
 * Refresh keeps the client state of the view. Filters, sort, search, and the open
 * offering all survive it, because `router.refresh()` replaces the server-rendered
 * data without remounting the page.
 *
 * Renders nothing until the probe finds a new release, so it costs no layout.
 *
 * Dismiss hides one release. The probe continues, so a later release brings the
 * notice back.
 */
export function FeedReleaseNotice({ generatedAt, sourceRevision, probeIntervalMs }: Props) {
  const newer = useNewerFeedRelease(generatedAt, sourceRevision, probeIntervalMs);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();

  if (!newer || dismissed === revisionKey(newer)) return null;

  return (
    <div className={styles.notice} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      <p className={styles.text}>
        <strong className={styles.lead}>The feed has a new release.</strong> The collectors generated
        it {formatRelativeTime(newer.generatedAt)}.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={`btn btn-primary ${styles.refresh}`}
          onClick={() => startTransition(() => router.refresh())}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh view"}
        </button>
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => setDismissed(revisionKey(newer))}
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">Dismiss</span>
        </button>
      </div>
    </div>
  );
}
