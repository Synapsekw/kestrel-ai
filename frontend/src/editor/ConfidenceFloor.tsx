interface Props {
  /** 0..1; proposals below it are hidden in the image and in the region list. */
  value: number;
  /** How many unreviewed proposals the floor hides on this image. */
  hidden: number;
  onChange: (value: number) => void;
}

/** Walk-through item E6: a dense model run is unreadable until the weak proposals are out of the way. */
export function ConfidenceFloor({ value, hidden, onChange }: Props) {
  const percent = Math.round(value * 100);
  return (
    <label data-testid="confidence-floor" className="flex items-center gap-1.5 text-xs text-slate-400">
      Hide proposals
      <input
        type="range"
        min={0}
        max={95}
        step={5}
        value={percent}
        aria-label="Hide proposals below this confidence"
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-24 accent-orange-500"
      />
      <span className="tabular-nums">
        {percent === 0 ? "all shown" : `below ${percent}% · ${hidden} hidden`}
      </span>
    </label>
  );
}
