import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import { cx } from "./tokens";

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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A centred modal: focus moves inside on open, Tab cycles within, Escape and a backdrop click close,
 * focus returns to the opener on close. Rendered into `document.body`.
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
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4 animate-[reveal_140ms_ease-out_both] motion-reduce:animate-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          "flex max-h-[calc(100%-2rem)] w-full flex-col rounded-lg border border-line bg-panel text-ink shadow-float outline-none animate-pop motion-reduce:animate-none",
          width === "lg" ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
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
      </div>
    </div>,
    document.body,
  );
}
