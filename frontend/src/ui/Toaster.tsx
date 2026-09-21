import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "./Button";
import { Icon } from "./Icon";
import { cx } from "./tokens";
import { useToastStore, type Toast } from "./toastStore";

/** Milliseconds a toast stays unless hovered. */
export const TOAST_TTL = 6000;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_TTL);
  const startedAt = useRef(0);
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const t = window.setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, dismiss, toast.id]);

  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto flex min-w-[18rem] max-w-md items-center gap-2.5 rounded-md bg-inverse py-2 pl-3 pr-2 text-sm font-medium text-inverse-fg shadow-float animate-reveal motion-reduce:animate-none"
    >
      <span
        className={cx(
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full",
          toast.tone === "ok"
            ? "bg-ok text-ground"
            : toast.tone === "danger"
              ? "bg-danger text-ground"
              : "bg-inverse-fg/20",
        )}
      >
        <Icon
          name={toast.tone === "ok" ? "check" : toast.tone === "danger" ? "warning" : "info"}
          size={11}
          className="[stroke-width:3]"
        />
      </span>
      <span className="min-w-0 flex-1 leading-snug">{toast.text}</span>
      {toast.action && (
        <Button
          size="sm"
          variant="ghost"
          className="text-inverse-fg hover:bg-inverse-fg/10"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton
        icon="x"
        label="Dismiss"
        size="sm"
        className="text-inverse-fg/70 hover:bg-inverse-fg/10 hover:text-inverse-fg"
        onClick={() => dismiss(toast.id)}
      />
    </div>
  );
}

/** Mount once, in the shell. Bottom right, newest at the bottom. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
