export function Wordmark({ size = 22 }: { size?: number }) {
  // A precise, instrument-like mark: a signal square with a routed notch.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--brand)" />
      <path
        d="M6.5 15.5V8.5L12 12l5.5-3.5v7"
        stroke="var(--on-fill)"
        strokeWidth="1.9"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
