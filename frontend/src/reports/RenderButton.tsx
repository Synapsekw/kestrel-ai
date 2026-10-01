import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconButton, Icon, Popover, cx, focusRing } from "@/ui";
import { toggleFormat, type RenderFormat } from "./builderModel";

const ITEMS: { fmt: RenderFormat; label: string; hint: string }[] = [
  { fmt: "pdf", label: "PDF", hint: "always" },
  { fmt: "csv", label: "CSV", hint: "findings table" },
  { fmt: "xlsx", label: "XLSX", hint: "findings workbook" },
];

export interface RenderButtonProps {
  formats: RenderFormat[];
  onFormatsChange: (formats: RenderFormat[]) => void;
  onRender: () => void;
  busy: boolean;
}

/** Spec §12 "Render (a split button with the formats)", Ruling 3: checkbox menu items on a Popover. */
export function RenderButton({ formats, onFormatsChange, onRender, busy }: RenderButtonProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
    );
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="inline-flex items-stretch">
      <Button variant="primary" icon="report" loading={busy} onClick={onRender} className="rounded-r-none">
        Render
      </Button>
      <IconButton
        ref={anchor}
        variant="primary"
        icon="chevron-down"
        label="Render options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="rounded-l-none border-l border-line"
      />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        label="Render formats"
        role="menu"
        align="end"
      >
        <div className="flex min-w-[13rem] flex-col gap-0.5" onKeyDown={onMenuKey}>
          <p className="px-2.5 pb-1 pt-0.5 text-2xs text-muted">Files in the next version</p>
          {ITEMS.map(({ fmt, label, hint }) => {
            const on = formats.includes(fmt);
            return (
              <button
                key={fmt}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                aria-label={label}
                aria-disabled={fmt === "pdf" || undefined}
                aria-describedby={`${hintId}-${fmt}`}
                onClick={() => onFormatsChange(toggleFormat(formats, fmt))}
                className={cx(
                  "flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-ink hover:bg-surface-2",
                  fmt === "pdf" && "cursor-default text-muted hover:bg-transparent",
                  focusRing,
                )}
              >
                <span className="grid w-4 place-items-center">{on && <Icon name="check" size={14} />}</span>
                <span className="flex-1">{label}</span>
                <span id={`${hintId}-${fmt}`} className="text-2xs text-muted">
                  {hint}
                </span>
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
