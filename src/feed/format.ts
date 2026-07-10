export function formatTokens(tokens: number | null | undefined): string {
  if (tokens == null) return "—";
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${m % 1 === 0 ? m : Math.floor(m * 10) / 10}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    if (k % 1 === 0) return `${k}K`;
    const value = k < 10 ? Math.floor(k * 10) / 10 : Math.floor(k);
    return `${value}K`;
  }
  return String(tokens);
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
