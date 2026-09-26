import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { GlassPanel } from "./GlassPanel";
import { Icon, type IconName } from "./Icon";
import { Kbd, KeyChord } from "./Kbd";
import { useListNavigation } from "./listbox";
import { cx } from "./tokens";
import { useFocusTrap } from "./useFocusTrap";

export interface Command {
  id: string;
  title: string;
  hint?: string;
  icon?: IconName;
  shortcut?: string;
  run: () => void;
}

export interface CommandGroup {
  label: string;
  items: readonly Command[];
}

export interface CommandSource {
  id: string;
  label: string;
  /** Characters before the source is asked; 2 by default (spec §5.4). */
  minQuery?: number;
  search: (query: string, signal: AbortSignal) => Promise<readonly Command[]>;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  groups: readonly CommandGroup[];
  sources?: readonly CommandSource[];
  placeholder?: string;
}

export const SEARCH_DEBOUNCE_MS = 120;
const DEFAULT_MIN_QUERY = 2;

interface Found {
  query: string;
  status: "loading" | "done" | "error";
  items: readonly Command[];
}

interface Section {
  label: string;
  items: readonly Command[];
  note?: string;
}

function Palette({
  onClose,
  groups,
  sources = [],
  placeholder = "Search or jump to…",
}: Omit<CommandPaletteProps, "open">) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Record<string, Found>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass inline arrays; reading them through a ref keeps a new array from restarting (and
  // aborting) the pending search on every parent render.
  const sourcesRef = useRef(sources);
  const onTab = useFocusTrap(panelRef, true);
  const listId = useId();
  const q = query.trim();

  useEffect(() => {
    sourcesRef.current = sources;
  });

  useEffect(() => {
    const live = sourcesRef.current.filter((s) => q.length >= (s.minQuery ?? DEFAULT_MIN_QUERY));
    if (live.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      for (const source of live) {
        setFound((f) => ({ ...f, [source.id]: { query: q, status: "loading", items: [] } }));
        source.search(q, controller.signal).then(
          (items) => {
            if (!controller.signal.aborted) {
              setFound((f) => ({ ...f, [source.id]: { query: q, status: "done", items } }));
            }
          },
          () => {
            if (!controller.signal.aborted) {
              setFound((f) => ({ ...f, [source.id]: { query: q, status: "error", items: [] } }));
            }
          },
        );
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const needle = q.toLowerCase();
  const matches = (c: Command) => !needle || `${c.title} ${c.hint ?? ""}`.toLowerCase().includes(needle);
  const sections: Section[] = [];
  for (const group of groups) {
    const items = group.items.filter(matches);
    if (items.length) sections.push({ label: group.label, items });
  }
  for (const source of sources) {
    if (q.length < (source.minQuery ?? DEFAULT_MIN_QUERY)) continue;
    const f = found[source.id];
    if (!f || f.query !== q || f.status === "loading") {
      sections.push({ label: source.label, items: [], note: "Searching…" });
    } else if (f.status === "error") {
      sections.push({
        label: source.label,
        items: [],
        note: `Couldn't search ${source.label.toLowerCase()}`,
      });
    } else if (f.items.length) {
      sections.push({ label: source.label, items: f.items });
    }
  }
  const flat = sections.flatMap((s) => s.items);
  const starts = sections.map((_, n) => sections.slice(0, n).reduce((sum, s) => sum + s.items.length, 0));
  const { index, setIndex, move } = useListNavigation(flat.length, q);

  const run = (command: Command) => {
    onClose();
    command.run();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (move(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const command = flat[index];
      if (command) run(command);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center bg-bg/50 px-4 pt-[14vh] animate-fade reduce-motion:animate-none"
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
        aria-label="Command palette"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          onTab(e);
        }}
        className="flex h-fit max-h-[min(70vh,560px)] w-full max-w-[640px] flex-col overflow-hidden shadow-elev-2 animate-pop reduce-motion:animate-none"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Icon name="search" size={16} className="text-muted" />
          <input
            role="combobox"
            aria-label="Command"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? `${listId}-${index}` : undefined}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-dim focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div id={listId} role="listbox" aria-label="Commands" className="overflow-y-auto p-1.5">
          {sections.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No matches</p>}
          {sections.map((section, n) => (
            <div key={section.label} role="group" aria-label={section.label}>
              <p aria-hidden="true" className="px-2.5 pb-1 pt-2 text-2xs text-muted">
                {section.label}
              </p>
              {section.note && <p className="px-2.5 py-1.5 text-sm text-dim">{section.note}</p>}
              {section.items.map((command, k) => {
                const i = starts[n] + k;
                return (
                  <div
                    key={command.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === index}
                    onMouseMove={() => i !== index && setIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(command)}
                    className={cx(
                      "flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm text-ink",
                      i === index && "bg-accent-soft",
                    )}
                  >
                    {command.icon ? (
                      <Icon name={command.icon} size={15} className="text-muted" />
                    ) : (
                      <span aria-hidden="true" className="w-[15px]" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {command.title}
                      {command.hint && <span className="ml-2 text-2xs text-muted">{command.hint}</span>}
                    </span>
                    {command.shortcut && <KeyChord chord={command.shortcut} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>,
    document.body,
  );
}

/**
 * The Ctrl K palette (spec §5.4): a glass dialog with a combobox over grouped commands and debounced
 * async search sources. Mounting on open resets the query each time.
 */
export function CommandPalette({ open, ...rest }: CommandPaletteProps) {
  return open ? <Palette {...rest} /> : null;
}
