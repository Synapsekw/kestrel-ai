import { useState } from "react";
import { stagger } from "@/ui/motion";

export const title = "Motion";
export const order = 12;

export default function MotionSection() {
  const [run, setRun] = useState(0);
  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={() => setRun((r) => r + 1)}
        className="w-fit text-sm text-accent-ink underline"
      >
        Replay the entrance
      </button>
      <ul key={run} className="grid grid-cols-6 gap-2">
        {Array.from({ length: 12 }, (_, i) => (
          <li
            key={i}
            style={stagger(i)}
            className="stagger animate-rise rounded-control border border-card-line bg-surface p-3 text-2xs text-muted"
          >
            item {i + 1}
          </li>
        ))}
      </ul>
      <p className="text-2xs text-muted">
        Items 9 to 12 arrive with item 8 (--stagger-max). With reduced motion all arrive at once.
      </p>
    </div>
  );
}
