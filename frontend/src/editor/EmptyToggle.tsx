import type { Image as ImageRow } from "@contract/client";
import { GROUND_TRUTH_MESSAGE } from "./commands";

interface Props {
  image: ImageRow | null;
  /** The image has an accepted or edited box in the store: marking it empty is refused. */
  hasGroundTruth: boolean;
  busy: boolean;
  onToggle: () => void;
}

/** "No machinery" toolbar action (hotkey N, spec section 6, walk-through item E4). */
export function EmptyToggle({ image, hasGroundTruth, busy, onToggle }: Props) {
  const marked = image?.marked_empty ?? false;
  const disabled = busy || hasGroundTruth || !image;
  return (
    <button
      type="button"
      aria-pressed={marked}
      disabled={disabled}
      title={hasGroundTruth ? GROUND_TRUTH_MESSAGE : undefined}
      onClick={onToggle}
      className={`rounded border px-2 py-0.5 text-xs disabled:opacity-40 ${
        marked
          ? "border-slate-500 bg-slate-700 text-white hover:bg-slate-600"
          : "border-slate-700 text-slate-200 hover:bg-slate-800"
      }`}
    >
      {marked ? "Marked empty - undo (N)" : "No machinery (N)"}
    </button>
  );
}
