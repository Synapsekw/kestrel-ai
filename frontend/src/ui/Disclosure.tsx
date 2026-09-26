import { useId, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { cx, focusRing, transition } from "./tokens";

export interface DisclosureProps {
  label?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /** A muted note after the label ("6 settings"). */
  summary?: ReactNode;
}

/** "More options": a button that reveals a block. The content is not rendered while closed. */
export function Disclosure({
  label = "More options",
  defaultOpen = false,
  open,
  onOpenChange,
  children,
  className,
  summary,
}: DisclosureProps) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const id = useId();
  const toggle = () => {
    const next = !isOpen;
    setInner(next);
    onOpenChange?.(next);
  };
  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={toggle}
        className={cx(
          "inline-flex h-7 w-fit items-center gap-1.5 rounded-md pl-1 pr-2 text-sm font-medium text-muted hover:bg-hover hover:text-ink",
          transition,
          focusRing,
        )}
      >
        <Icon
          name="chevron-right"
          size={14}
          className={cx(
            "transition-transform duration-fast ease-out reduce-motion:transition-none",
            isOpen && "rotate-90",
          )}
        />
        {label}
        {summary && <span className="font-normal text-dim">{summary}</span>}
      </button>
      {isOpen && (
        <div id={id} className="animate-reveal reduce-motion:animate-none">
          {children}
        </div>
      )}
    </div>
  );
}
