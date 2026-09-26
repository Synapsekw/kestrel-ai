import type { Image as ImageRow } from "@contract/client";
import { Button } from "@/ui";
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
    <Button
      size="sm"
      aria-pressed={marked}
      disabled={disabled}
      icon={marked ? "check" : undefined}
      title={hasGroundTruth ? GROUND_TRUTH_MESSAGE : undefined}
      onClick={onToggle}
      // N toggles this: the pressed look changes without a transition.
      className={marked ? "!border-line-strong !bg-surface-2 !transition-none" : "!transition-none"}
    >
      {marked ? "Marked empty - undo (N)" : "No machinery (N)"}
    </Button>
  );
}
