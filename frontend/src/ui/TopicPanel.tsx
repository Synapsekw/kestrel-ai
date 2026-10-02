import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ToolButton } from "./FloatingToolbar";
import { IconButton } from "./Button";
import type { IconName } from "./Icon";
import { cx, focusRing } from "./tokens";
import { computeWindow, useVirtualRows } from "./useVirtualRows";

export interface TopicTool {
  id: string;
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabledReason?: string | null;
  onClick(): void;
}

export interface TopicPanelProps {
  title: string;
  count?: number | string | null;
  visible?: { value: boolean; toggle(): void };
  menu?: ReactNode;
  tools?: readonly TopicTool[];
  filters?: ReactNode;
  children: ReactNode;
}

/** "Findings" -> "findings", but keep acronyms ("AI") intact. */
function noun(title: string): string {
  return /^[A-Z]{2}/.test(title) ? title : title.charAt(0).toLowerCase() + title.slice(1);
}

/** Spec §2: every topic reads header → tool row → filters → list. */
export function TopicPanel({ title, count, visible, menu, tools = [], filters, children }: TopicPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 px-3 py-2.5">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {count !== undefined && count !== null && (
          <span className="font-mono text-2xs tabular-nums text-muted">{count}</span>
        )}
        <span className="flex-1" />
        {menu}
        {visible && (
          <IconButton
            size="sm"
            icon={visible.value ? "eye" : "eye-off"}
            label={`${visible.value ? "Hide" : "Show"} ${noun(title)}`}
            aria-pressed={visible.value}
            onClick={visible.toggle}
          />
        )}
      </header>
      {tools.length > 0 && (
        <div
          role="group"
          aria-label={`${title} tools`}
          className="flex flex-wrap gap-0.5 border-b border-line px-2 pb-2"
        >
          {tools.map((t) => (
            <ToolButton
              key={t.id}
              icon={t.icon}
              label={t.disabledReason ? `${t.label} — ${t.disabledReason}` : t.label}
              shortcut={t.shortcut}
              active={t.active}
              disabled={!!t.disabledReason}
              onClick={t.onClick}
              tooltipSide="bottom"
            />
          ))}
        </div>
      )}
      {filters && <div className="border-b border-line px-3 py-2">{filters}</div>}
      <div className="flex min-h-0 flex-1 flex-col px-2 py-2">{children}</div>
    </div>
  );
}

export interface TopicItem {
  id: string;
  label: string;
  meta?: string;
  /** A data colour (severity, class), passed as `--c`. */
  swatch?: string;
}

export interface TopicListProps {
  label: string;
  items: readonly TopicItem[];
  selectedId: string | null;
  onSelect(id: string): void;
  empty?: ReactNode;
}

export const TOPIC_ROW_HEIGHT = 40;

/** A virtualised single-select list; the selected row is scrolled into view (spec §4 "Selection"). */
export function TopicList({ label, items, selectedId, onSelect, empty }: TopicListProps) {
  const { containerRef, onScroll, height, scrollTop, scrollToIndex } = useVirtualRows({
    rowHeight: TOPIC_ROW_HEIGHT,
  });
  const win = computeWindow(scrollTop, height, TOPIC_ROW_HEIGHT, items.length);
  const selectedIndex = selectedId === null ? -1 : items.findIndex((i) => i.id === selectedId);
  useEffect(() => {
    if (selectedIndex < 0) return;
    scrollToIndex(selectedIndex);
    onScroll(); // sync the window now; jsdom and some engines do not dispatch scroll for programmatic moves
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll only when the selection moves
  }, [selectedIndex]);
  // The scroll container always renders (the empty state inside it), so the viewport's
  // ResizeObserver is attached even when the list first renders empty.
  const isEmpty = items.length === 0;
  return (
    <div
      ref={containerRef}
      role={isEmpty ? undefined : "listbox"}
      aria-label={isEmpty ? undefined : label}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      {isEmpty ? (
        empty
      ) : (
        <div style={{ height: win.totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${win.offsetTop}px)` }}>
            {items.slice(win.start, win.end).map((item) => {
              const on = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => onSelect(item.id)}
                  style={
                    { height: TOPIC_ROW_HEIGHT, "--c": item.swatch ?? "var(--surface-2)" } as CSSProperties
                  }
                  className={cx(
                    "flex w-full items-center gap-2 rounded-control px-2 text-left hover:bg-hover",
                    on && "bg-accent-soft",
                    focusRing,
                  )}
                >
                  {item.swatch && (
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--c)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
                  {item.meta && (
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-muted">{item.meta}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
