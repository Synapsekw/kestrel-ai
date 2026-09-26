/* eslint-disable react-refresh/only-export-components --
   the filter helper is exported next to the component for its tests; not a fast-refresh boundary. */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon, type IconName } from "./Icon";
import { fieldClass, Input } from "./Input";
import { Kbd } from "./Kbd";
import { useListNavigation } from "./listbox";
import { Popover } from "./Popover";
import { cx } from "./tokens";

export interface ComboItem {
  id: string;
  label: string;
  icon?: IconName;
  hint?: string;
  /** A catalogue type hotkey; live only inside this picker, and only while the filter is empty. */
  hotkey?: string | null;
  /** #rrggbb swatch (catalogue types); travels as --c. */
  colour?: string;
}

export function filterItems(items: readonly ComboItem[], query: string): ComboItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((i) => i.label.toLowerCase().includes(q) || (i.hint ?? "").toLowerCase().includes(q));
}

function Swatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-[color:var(--c)]"
      style={{ "--c": colour } as CSSProperties}
    />
  );
}

export interface ComboboxListProps {
  label: string;
  items: readonly ComboItem[];
  value: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
}

/** A filter field over a listbox (the CommandPalette pattern). Embed it in a Popover for a type picker. */
export function ComboboxList({
  label,
  items,
  value,
  onSelect,
  placeholder = "Filter…",
  emptyText = "No matches",
}: ComboboxListProps) {
  const [query, setQuery] = useState("");
  const shown = filterItems(items, query);
  const { index, setIndex, move } = useListNavigation(shown.length, query);
  const listId = useId();
  const optionId = (i: number) => `${listId}-o${i}`;

  useEffect(() => {
    document.getElementById(`${listId}-o${index}`)?.scrollIntoView?.({ block: "nearest" });
  }, [listId, index]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (move(e)) return;
    if (e.key === "Enter") {
      const item = shown[index];
      if (item) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(item.id);
      }
      return;
    }
    if (query === "" && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const hit = items.find((i) => i.hotkey && i.hotkey.toLowerCase() === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(hit.id);
      }
    }
  };

  return (
    <div className="flex w-[280px] flex-col gap-1.5">
      <Input
        dense
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown.length ? optionId(index) : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
        {shown.length === 0 ? (
          <li role="presentation" className="px-2.5 py-2 text-sm text-muted">
            {emptyText}
          </li>
        ) : (
          shown.map((item, i) => (
            <li
              key={item.id}
              id={optionId(i)}
              role="option"
              aria-selected={item.id === value}
              onMouseMove={() => i !== index && setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(item.id)}
              className={cx(
                "flex h-8 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm text-ink",
                i === index && "bg-surface-2",
              )}
            >
              {item.colour ? (
                <Swatch colour={item.colour} />
              ) : item.icon ? (
                <Icon name={item.icon} size={15} className="text-muted" />
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                {item.label}
                {item.hint && <span className="ml-2 text-2xs text-muted">{item.hint}</span>}
              </span>
              {item.id === value && <Icon name="check" size={14} className="text-accent-ink" />}
              {item.hotkey && <Kbd>{item.hotkey.toUpperCase()}</Kbd>}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export interface ComboboxProps extends Omit<ComboboxListProps, "onSelect"> {
  onChange: (id: string) => void;
  disabled?: boolean;
  triggerPlaceholder?: string;
  className?: string;
}

/** A filterable single-select: a field-styled trigger that opens ComboboxList in a Popover. */
export function Combobox({
  label,
  items,
  value,
  onChange,
  disabled,
  triggerPlaceholder = "Choose…",
  className,
  ...list
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = items.find((i) => i.id === value) ?? null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? "none"}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
        className={fieldClass(false, cx("flex h-[34px] items-center gap-2 px-3 text-left", className))}
      >
        {selected?.colour && <Swatch colour={selected.colour} />}
        <span className={cx("min-w-0 flex-1 truncate", !selected && "text-dim")}>
          {selected?.label ?? triggerPlaceholder}
        </span>
        <Icon name="chevron-down" size={14} className="text-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={trigger} label={label}>
        <ComboboxList
          label={label}
          items={items}
          value={value}
          onSelect={(id) => {
            setOpen(false);
            onChange(id);
          }}
          {...list}
        />
      </Popover>
    </>
  );
}
