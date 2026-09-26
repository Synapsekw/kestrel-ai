import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import { GlassPanel } from "./GlassPanel";
import { cx } from "./tokens";
import { useFocusTrap } from "./useFocusTrap";

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Buttons, right-aligned. */
  footer?: ReactNode;
  width?: "md" | "lg";
  /** A short line under the title. */
  description?: ReactNode;
  /** Forwarded as `data-testid`. */
  testId?: string;
  /** Wrap the body in a form and route submit to this handler; the footer sits inside the form. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * A centred modal on floating glass: focus moves inside on open, Tab cycles within, Escape and a
 * backdrop click close, focus returns to the opener. Enters with a 260 ms pop (--dur-slow).
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  width = "md",
  description,
  testId,
  onSubmit,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onTab = useFocusTrap(panelRef, open);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    onTab(e);
  };

  const body = (
    <>
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {footer}
        </div>
      )}
    </>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-bg/60 p-4 animate-fade reduce-motion:animate-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <GlassPanel
        ref={panelRef}
        variant="float"
        radius="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          "flex max-h-[calc(100%-2rem)] w-full flex-col text-ink shadow-elev-2 outline-none animate-pop reduce-motion:animate-none",
          width === "lg" ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton icon="x" label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-1" />
        </div>
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            {body}
          </form>
        ) : (
          body
        )}
      </GlassPanel>
    </div>,
    document.body,
  );
}
