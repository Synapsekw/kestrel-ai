import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Button, IconButton, type ButtonProps } from "./Button";
import type { Align, Side } from "./floating";
import { Icon, type IconName } from "./Icon";
import { KeyChord } from "./Kbd";
import { Popover } from "./Popover";
import { cx, disabledClass } from "./tokens";

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** A muted note after the label ("Arrives with the Maps workspace"). */
  hint?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  items: readonly MenuItem[];
  label: string;
  side?: Side;
  align?: Align;
}

const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

function MenuItems({ items, onClose }: { items: readonly MenuItem[]; onClose: () => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!MENU_KEYS.has(e.key)) return;
    // The list owns these keys even when it has nothing to move to: none reaches the workspace.
    e.preventDefault();
    e.stopPropagation();
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
    );
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown"
        ? buttons[(at + 1) % buttons.length]
        : e.key === "ArrowUp"
          ? buttons[at <= 0 ? buttons.length - 1 : at - 1]
          : e.key === "Home"
            ? buttons[0]
            : e.key === "End"
              ? buttons[buttons.length - 1]
              : undefined;
    next?.focus();
  };
  return (
    <div className="flex flex-col gap-0.5" onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={cx(
            "flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm focus-visible:outline-none",
            item.danger
              ? "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft"
              : "text-ink hover:bg-surface-2 focus-visible:bg-surface-2",
            disabledClass,
          )}
        >
          {item.icon && <Icon name={item.icon} size={15} className="text-muted" />}
          <span className="min-w-0 flex-1 truncate">
            {item.label}
            {item.hint && <span className="ml-2 text-2xs text-muted">{item.hint}</span>}
          </span>
          {item.shortcut && <KeyChord chord={item.shortcut} className="shrink-0" />}
        </button>
      ))}
    </div>
  );
}

/** A popover list of actions ("Add data", row actions, overflow tabs). ↑ ↓ Home End move; Enter picks. */
export function Menu({ open, onClose, anchorRef, items, label, side, align = "end" }: MenuProps) {
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      label={label}
      role="menu"
      side={side}
      align={align}
    >
      <MenuItems items={items} onClose={onClose} />
    </Popover>
  );
}

export interface MenuButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  label: string;
  items: readonly MenuItem[];
  /** The menu's name; defaults to `label`. */
  menuLabel?: string;
  /** An IconButton (overflow "…") instead of a labelled button. */
  iconOnly?: boolean;
  side?: Side;
  align?: Align;
}

/** A button that opens a Menu; ArrowDown opens it from the keyboard. */
export function MenuButton({
  label,
  items,
  menuLabel,
  iconOnly = false,
  icon,
  side,
  align,
  ...button
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const trigger = {
    ref,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    onClick: () => setOpen((o) => !o),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }
    },
  };
  return (
    <>
      {iconOnly ? (
        <IconButton icon={icon ?? "chevron-down"} label={label} {...button} {...trigger} />
      ) : (
        <Button icon={icon} {...button} {...trigger}>
          {label}
          <Icon name="chevron-down" size={14} className="text-muted" />
        </Button>
      )}
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        items={items}
        label={menuLabel ?? label}
        side={side}
        align={align}
      />
    </>
  );
}
