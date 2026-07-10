"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS } from "./docs";
import styles from "./docs.module.css";

const EXTERNAL = [
  { href: "/v1/schema", label: "JSON Schema" },
  { href: "/v1/feed", label: "Live feed" }
];

export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="Documentation">
      <p className={styles.navTitle}>Documentation</p>
      <ul className={styles.navList}>
        <li>
          <Link
            href="/docs"
            className={styles.navLink}
            aria-current={pathname === "/docs" ? "page" : undefined}
          >
            Overview
          </Link>
        </li>
        {DOCS.map((doc) => {
          const href = `/docs/${doc.slug}`;
          return (
            <li key={doc.slug}>
              <Link
                href={href}
                className={styles.navLink}
                aria-current={pathname === href ? "page" : undefined}
              >
                {doc.title}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className={styles.navTitle}>Reference</p>
      <ul className={styles.navList}>
        {EXTERNAL.map((item) => (
          <li key={item.href}>
            <a href={item.href} className={`${styles.navLink} mono`}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
