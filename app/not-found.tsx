import Link from "next/link";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <div className={`page ${styles.wrap}`}>
      <p className="eyebrow">404</p>
      <h1 className={styles.title}>No such page in this feed.</h1>
      <p className={styles.lede}>
        The page you&rsquo;re looking for doesn&rsquo;t exist — it may have moved, or the link is stale.
      </p>
      <div className={styles.actions}>
        <Link href="/" className="btn btn-primary">
          Go home
        </Link>
        <Link href="/explore" className="btn btn-secondary">
          Browse the feed
        </Link>
      </div>
    </div>
  );
}
