import { useRef, type ReactNode } from "react";
import { Popover } from "@/ui";

/**
 * F's Popover anchored to a point on the stage (`px` from W1's `viewApi.pixelOf`). The overlay that
 * renders it sits in W1's positioned workspace root, so a 1 px absolute span is the anchor.
 */
export function PointPopover(props: {
  px: readonly number[];
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { px, label, onClose, children } = props;
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span
        ref={anchor}
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px"
        style={{ left: px[0], top: px[1] }}
      />
      <Popover open onClose={onClose} anchorRef={anchor} label={label} side="right" align="start">
        {children}
      </Popover>
    </>
  );
}
