import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { SectionKey } from "@/api/reports";
import {
  Disclosure,
  Icon,
  IconButton,
  Switch,
  cx,
  dur,
  easing,
  focusRing,
  transition,
  useReducedMotion,
} from "@/ui";
import {
  SECTION_LABEL,
  moveSection,
  moveSectionTo,
  positionAnnouncement,
  setSectionEnabled,
  setSectionOptions,
  type Sections,
} from "./builderModel";
import { SectionOptions } from "./SectionOptions";

type ReportSection = Sections[number];
const DRAG_TYPE = "application/x-kestrel-report-section";

export interface SectionListProps {
  sections: Sections;
  onChange: (sections: Sections) => void;
  /**
   * R-7.2 (reports index recon 10, overrides plan Ruling 19): when given, each ENABLED row gets a
   * quiet "Show <label> in preview" button that calls it with the section's key. Task 9 wires it to
   * the preview pane's `scrollToSection`. Disabled rows never show the button; omitting the prop
   * renders no button at all.
   */
  onShow?: (key: SectionKey) => void;
}

/**
 * The builder's left pane (spec §12): drag handle, switch, name and an options Disclosure per section.
 * Reorder by drag or Alt+↑/↓ (from any control in the row), announced for screen readers. Cover is
 * pinned first. Rows glide to their new place over --dur-base with --ease-out, instantly under reduced
 * motion (WAAPI, no fill, so nothing keeps a transform).
 */
export function SectionList({ sections, onChange, onShow }: SectionListProps) {
  const [announcement, setAnnouncement] = useState("");
  const rows = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());
  const reduced = useReducedMotion();
  const order = sections.map((s) => s.key).join(",");

  useLayoutEffect(() => {
    const next = new Map<string, number>();
    rows.current.forEach((el, key) => {
      const top = el.getBoundingClientRect().top;
      next.set(key, top);
      const before = tops.current.get(key);
      if (reduced || before === undefined || before === top || typeof el.animate !== "function") return;
      el.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], {
        duration: dur.base,
        easing: `cubic-bezier(${easing.out.join(",")})`,
      });
    });
    tops.current = next;
  }, [order, reduced]);

  const move = (next: Sections | null, key: SectionKey) => {
    if (!next) return;
    onChange(next);
    setAnnouncement(positionAnnouncement(next, key));
  };

  return (
    <div className="flex flex-col gap-2">
      <ol aria-label="Sections" className="flex flex-col gap-1.5">
        {sections.map((s) => (
          <SectionRow
            key={s.key}
            section={s}
            rowRef={(el) => {
              if (el) rows.current.set(s.key, el);
              else rows.current.delete(s.key);
            }}
            onToggle={(enabled) => onChange(setSectionEnabled(sections, s.key, enabled))}
            onOptions={(patch) => onChange(setSectionOptions(sections, s.key, patch))}
            onMove={(delta) => move(moveSection(sections, s.key, delta), s.key)}
            onDropOn={(dragged) => move(moveSectionTo(sections, dragged, s.key), dragged)}
            onShow={onShow}
          />
        ))}
      </ol>
      <p className="px-1 text-2xs text-muted">
        Drag a section, or press Alt+↑ or Alt+↓ inside it, to move it.
      </p>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function SectionRow({
  section,
  rowRef,
  onToggle,
  onOptions,
  onMove,
  onDropOn,
  onShow,
}: {
  section: ReportSection;
  rowRef: (el: HTMLLIElement | null) => void;
  onToggle: (enabled: boolean) => void;
  onOptions: (patch: Record<string, unknown>) => void;
  onMove: (delta: -1 | 1) => void;
  onDropOn: (dragged: SectionKey) => void;
  onShow?: (key: SectionKey) => void;
}) {
  const key = section.key;
  const label = SECTION_LABEL[key];
  const pinned = key === "cover";

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    e.stopPropagation();
    onMove(e.key === "ArrowUp" ? -1 : 1);
  };
  const onDragStart = (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.setData(DRAG_TYPE, key);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: DragEvent<HTMLLIElement>) => {
    if (Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) e.preventDefault();
  };
  const onDrop = (e: DragEvent<HTMLLIElement>) => {
    const dragged = e.dataTransfer.getData(DRAG_TYPE);
    if (!dragged || dragged === key) return;
    e.preventDefault();
    onDropOn(dragged as SectionKey);
  };

  return (
    <li
      ref={rowRef}
      data-key={key}
      draggable={!pinned}
      onDragStart={pinned ? undefined : onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      className={cx(
        "group/row flex flex-col gap-1 rounded-control border border-line bg-surface px-2 py-1.5",
        transition,
      )}
    >
      <div className="flex items-center gap-2">
        {pinned ? (
          <span className="grid h-6 w-5 place-items-center text-dim" title="Cover always prints first">
            <Icon name="pin" size={13} />
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Reorder ${label}`}
            className={cx(
              "grid h-6 w-5 cursor-grab place-items-center rounded-sm text-dim hover:text-ink",
              focusRing,
            )}
          >
            <Icon name="grip" size={14} />
          </button>
        )}
        <Switch
          checked={section.enabled}
          onChange={onToggle}
          label={label}
          className={cx("min-w-0 flex-1", !section.enabled && "text-muted")}
        />
        {onShow && section.enabled && (
          <IconButton
            icon="eye"
            size="sm"
            variant="ghost"
            label={`Show ${label} in preview`}
            onClick={() => onShow(key)}
          />
        )}
      </div>
      <Disclosure label="Options" className="pl-7">
        <SectionOptions section={section} onChange={onOptions} />
      </Disclosure>
    </li>
  );
}
