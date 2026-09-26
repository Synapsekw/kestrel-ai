import type { CSSProperties } from "react";

interface Props {
  label: string;
  value: string;
  onChange: (colour: string) => void;
  disabled?: boolean;
}

/**
 * The browser's own colour picker drawn as a swatch. The colour is data, so it reaches CSS only
 * through `--c` (F §4.5).
 */
export function ColourSwatch({ label, value, onChange, disabled }: Props) {
  return (
    <span
      className="relative inline-block h-7 w-7 shrink-0 overflow-hidden rounded-sm border border-line bg-[var(--c)] focus-within:ring-2 focus-within:ring-accent"
      style={{ "--c": value } as CSSProperties}
      title={label}
    >
      <input
        aria-label={label}
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </span>
  );
}
