"use client";

import { useEffect, useState } from "react";
import {
  FEED_REVISION_PATH,
  isNewerRelease,
  parseFeedRevision,
  revisionKey,
  type FeedRevision
} from "../lib/feed-revision";

/**
 * How often the browser probes for a new release.
 *
 * This is the only place the interval is set. No environment variable overrides
 * it, so edit this constant to change it for every deployment. Collectors publish
 * every four hours, so a five-minute probe finds a new release well before a
 * reader needs it. Each open tab costs one request per interval.
 *
 * See the freshness sections in `README.md` and `docs/deployment.md`.
 */
export const FEED_PROBE_INTERVAL_MS = 5 * 60_000;

/**
 * Watch for a release that is newer than the one this page rendered from.
 *
 * Returns null while the page is current. It returns the new revision once the
 * probe finds one, and it goes back to null when the page re-renders from that
 * release.
 *
 * The probe keeps running after it finds a release. A reader who dismisses the
 * notice must still learn about the release after that one.
 *
 * The two identity fields are separate arguments on purpose: an object argument
 * would be a new value on every render, and the probe would restart each time.
 */
export function useNewerFeedRelease(
  generatedAt: string,
  sourceRevision: string,
  probeIntervalMs: number = FEED_PROBE_INTERVAL_MS
): FeedRevision | null {
  const [newer, setNewer] = useState<FeedRevision | null>(null);

  // Clear the result when the page re-renders from a later release. This runs
  // after a refresh, and also after a navigation to a page the server rendered
  // from the new release.
  useEffect(() => {
    setNewer(null);
  }, [generatedAt, sourceRevision]);

  useEffect(() => {
    const shown = { generatedAt, sourceRevision };
    const controller = new AbortController();

    async function probe() {
      // A hidden tab has no reader. Skip the request and probe again when the
      // reader comes back.
      if (document.visibilityState !== "visible") return;

      try {
        const response = await fetch(FEED_REVISION_PATH, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) return;

        const candidate = parseFeedRevision(await response.json());
        if (!candidate || !isNewerRelease(shown, candidate)) return;

        // Keep the previous value when the probe finds the same release again,
        // so a reader who dismissed the notice does not see it come back.
        setNewer((previous) =>
          previous && revisionKey(previous) === revisionKey(candidate) ? previous : candidate
        );
      } catch {
        // The reader is offline, the probe was aborted, or the reply was not
        // JSON. The next probe retries, so there is nothing to report here.
      }
    }

    const timer = setInterval(probe, probeIntervalMs);
    document.addEventListener("visibilitychange", probe);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", probe);
      controller.abort();
    };
  }, [generatedAt, sourceRevision, probeIntervalMs]);

  return newer;
}
