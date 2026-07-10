import type { Tone } from "../lib/format";

const TONE_CLASS: Record<Tone, string> = {
  ok: "chip-ok",
  warn: "chip-warn",
  bad: "chip-bad",
  neutral: ""
};

export function StatusChip({
  tone,
  children,
  dot = true
}: {
  tone: Tone;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`chip ${TONE_CLASS[tone]}`}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
