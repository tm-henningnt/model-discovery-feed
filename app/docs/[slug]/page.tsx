import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocsNav } from "../DocsNav";
import { DOCS, findDoc } from "../docs";
import styles from "../docs.module.css";

export function generateStaticParams() {
  return DOCS.map((doc) => ({ slug: doc.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) return {};
  return { title: doc.title, description: doc.summary };
}

async function readDoc(file: string): Promise<string | null> {
  try {
    const full = path.join(process.cwd(), "docs", "public", file);
    return await readFile(full, "utf8");
  } catch (error) {
    console.error(`docs: failed to read ${file}`, error);
    return null;
  }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) notFound();

  const content = await readDoc(doc.file);
  if (content === null) notFound();

  return (
    <div className={`page ${styles.shell}`}>
      <DocsNav />
      <article className={styles.main}>
        <div className={`prose ${styles.prose}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
