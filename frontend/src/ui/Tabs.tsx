import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useMatch, useResolvedPath } from "react-router-dom";
import { cx, focusRing, transition } from "./tokens";
import { useSlidingIndicator } from "./useSlidingIndicator";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** A badge in mono; null or undefined shows none. */
  count?: number | null;
  /** Link mode: the route. */
  to?: string;
  /** Link mode: only an exact match is active. */
  end?: boolean;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  label: string;
  /** Button mode: the active tab id. */
  value?: string;
  onChange?: (id: string) => void;
  /** Render router links; the active tab follows the route. */
  asLinks?: boolean;
  className?: string;
}

const tabClass = (on: boolean) =>
  cx(
    "relative flex items-center gap-1.5 whitespace-nowrap rounded-t-sm px-3 py-[11px] text-sm",
    on ? "font-semibold text-ink" : "text-muted hover:text-ink",
    "aria-disabled:pointer-events-none aria-disabled:opacity-45",
    transition,
    focusRing,
  );

function Count({ n }: { n?: number | null }) {
  if (n === null || n === undefined) return null;
  return (
    <span className="rounded-chip bg-surface-2 px-1.5 font-mono text-2xs text-muted">
      {n.toLocaleString()}
    </span>
  );
}

/** ← → Home End move focus between enabled tabs and call `activate` with the new one. */
function rove(e: KeyboardEvent<HTMLElement>, list: HTMLElement | null, activate: (el: HTMLElement) => void) {
  const tabs = Array.from(
    list?.querySelectorAll<HTMLElement>('[role="tab"]:not([aria-disabled="true"])') ?? [],
  );
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const next =
    e.key === "ArrowRight"
      ? tabs[(at + 1) % tabs.length]
      : e.key === "ArrowLeft"
        ? tabs[(at - 1 + tabs.length) % tabs.length]
        : e.key === "Home"
          ? tabs[0]
          : e.key === "End"
            ? tabs[tabs.length - 1]
            : null;
  if (!next) return;
  e.preventDefault();
  e.stopPropagation();
  next.focus();
  activate(next);
}

function TabList({
  label,
  className,
  listRef,
  barRef,
  onKeyDown,
  children,
}: {
  label: string;
  className?: string;
  listRef: RefObject<HTMLDivElement>;
  barRef: RefObject<HTMLSpanElement>;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("relative flex gap-0.5 border-b border-line", className)}
    >
      {children}
      <span
        ref={barRef}
        aria-hidden="true"
        data-part="indicator"
        className="pointer-events-none absolute -bottom-px left-0 h-0.5 w-[100px] origin-left rounded-chip bg-grad-ink opacity-0 data-[ready=true]:transition-transform data-[ready=true]:duration-emphasis data-[ready=true]:ease-out reduce-motion:transition-none"
      />
    </div>
  );
}

function ButtonTabs({ items, label, value, onChange, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(listRef, barRef, value, "scale");
  const focusable =
    items.find((t) => t.id === value && !t.disabled)?.id ?? items.find((t) => !t.disabled)?.id;
  return (
    <TabList
      label={label}
      className={className}
      listRef={listRef}
      barRef={barRef}
      onKeyDown={(e) =>
        rove(e, listRef.current, (el) => {
          if (el.dataset.itemId) onChange?.(el.dataset.itemId);
        })
      }
    >
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-disabled={t.disabled || undefined}
            disabled={t.disabled}
            tabIndex={t.id === focusable ? 0 : -1}
            data-item-id={t.id}
            data-indicator-target={on ? "true" : undefined}
            onClick={() => onChange?.(t.id)}
            className={tabClass(on)}
          >
            {t.label}
            <Count n={t.count} />
          </button>
        );
      })}
    </TabList>
  );
}

function LinkTab({ item }: { item: TabItem }) {
  const resolved = useResolvedPath(item.to ?? ".");
  const on = useMatch({ path: resolved.pathname, end: item.end ?? false }) !== null;
  return (
    <Link
      to={item.to ?? "."}
      role="tab"
      aria-selected={on}
      aria-disabled={item.disabled || undefined}
      tabIndex={on ? 0 : -1}
      data-item-id={item.id}
      data-indicator-target={on ? "true" : undefined}
      onClick={item.disabled ? (e) => e.preventDefault() : undefined}
      className={tabClass(on)}
    >
      {item.label}
      <Count n={item.count} />
    </Link>
  );
}

function LinkTabs({ items, label, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const { pathname } = useLocation();
  useSlidingIndicator(listRef, barRef, pathname, "scale");
  return (
    <TabList
      label={label}
      className={className}
      listRef={listRef}
      barRef={barRef}
      onKeyDown={(e) => rove(e, listRef.current, () => {})}
    >
      {items.map((t) => (
        <LinkTab key={t.id} item={t} />
      ))}
    </TabList>
  );
}

/**
 * Tabs with a sliding `--grad-ink` indicator (mockup .tabs .ink). Button mode activates on arrow keys;
 * link mode (`asLinks`) moves focus and Enter follows the link. Link mode needs a router.
 */
export function Tabs(props: TabsProps) {
  return props.asLinks ? <LinkTabs {...props} /> : <ButtonTabs {...props} />;
}
