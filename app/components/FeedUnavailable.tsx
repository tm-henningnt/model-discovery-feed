import styles from "./FeedUnavailable.module.css";

type Props = {
  /** What the reader came for, such as "the feed explorer". */
  surface?: string;
};

/**
 * Shown when the feed cannot be read. The bundled fixture is deliberately not
 * used here: it holds example offerings with invented scores, and showing those
 * during an outage would present invented numbers as measured ones.
 */
export function FeedUnavailable({ surface = "this page" }: Props) {
  return (
    <div className={styles.panel} role="status">
      <h2 className={styles.title}>The feed is unavailable</h2>
      <p className={styles.body}>
        This deployment cannot read its published feed release, so {surface} has nothing to show.
        No model data appears here on purpose. The alternative is example data with invented
        scores, which would look like real measurements.
      </p>
      <p className={styles.hint}>
        <code className="mono">GET /v1/status</code> reports the same fault for API clients.
      </p>
    </div>
  );
}
