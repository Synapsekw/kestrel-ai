import type { KeyboardEvent, ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";
import { Icon, type IconName } from "./Icon";
import { useToolShortcuts } from "./keymap";
import { Tooltip, type TooltipSide } from "./Tooltip";
import { cx, disabledClass, focusRing, pressable, transition } from "./tokens";

export interface ToolDef {
  id: string;
  icon: IconName;
  label: string;
  /** A chord from the workspace's keymap entries (ui/keymap.ts). */
  shortcut?: string;
  /** The keymap action this tool performs; required for a global key such as V, H or F. */
  action?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface ToolButtonProps {
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  tooltipSide?: TooltipSide;
}

/** One tool: the mockup's .tool — muted, the brand gradient with a glow when active. */
export function ToolButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
  tooltipSide = "right",
}: ToolButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide} delay={250}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active ?? undefined}
        aria-keyshortcuts={shortcut}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          "grid h-9 w-[38px] place-items-center rounded-[9px]",
          active
            ? "bg-grad-primary text-accent-fg shadow-glow"
            : "text-muted hover:bg-surface-2 hover:text-ink",
          transition,
          pressable,
          focusRing,
          disabledClass,
        )}
      >
        <Icon name={icon} size={18} />
      </button>
    </Tooltip>
  );
}

export function ToolSeparator({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  return (
    <span
      role="separator"
      aria-orientation={orientation === "vertical" ? "horizontal" : "vertical"}
      className={
        orientation === "vertical"
          ? "mx-1.5 my-1 h-px bg-line-strong"
          : "mx-1 my-1.5 w-px self-stretch bg-line-strong"
      }
    />
  );
}

export interface FloatingToolbarProps {
  label: string;
  tools?: readonly ToolDef[];
  orientation?: "vertical" | "horizontal";
  /** Bind the tools' shortcuts while mounted (default). */
  shortcuts?: boolean;
  className?: string;
  /** Extra controls after the tools (a zoom readout, a separator). */
  children?: ReactNode;
}

/** A group of tools floating as glass over a work surface (mockup .pal, .zoom). */
export function FloatingToolbar({
  label,
  tools = [],
  orientation = "vertical",
  shortcuts = true,
  className,
  children,
}: FloatingToolbarProps) {
  useToolShortcuts(
    tools.map((t) => ({
      shortcut: t.shortcut,
      action: t.action,
      onTrigger: t.onClick,
      disabled: t.disabled,
    })),
    shortcuts,
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const previous = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const next = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    if (e.key !== previous && e.key !== next) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // The toolbar owns its arrow keys even when there is no enabled tool to move from.
    e.stopPropagation();
    if (at < 0) return;
    e.preventDefault();
    buttons[(at + (e.key === next ? 1 : -1) + buttons.length) % buttons.length].focus();
  };
  return (
    <GlassPanel
      variant="float"
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      className={cx(
        "inline-flex gap-0.5 p-[5px] animate-reveal reduce-motion:animate-none",
        orientation === "vertical" ? "flex-col" : "flex-row items-center",
        className,
      )}
    >
      {tools.map((t) => (
        <ToolButton
          key={t.id}
          icon={t.icon}
          label={t.label}
          shortcut={t.shortcut}
          active={t.active}
          disabled={t.disabled}
          onClick={t.onClick}
          tooltipSide={orientation === "vertical" ? "right" : "bottom"}
        />
      ))}
      {children}
    </GlassPanel>
  );
}
