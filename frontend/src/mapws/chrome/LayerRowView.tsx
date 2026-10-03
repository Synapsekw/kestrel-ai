import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Icon, IconButton, MenuButton, Pill, Slider, cx } from "@/ui";
import type { LayerKind, LayerRow } from "../layers/layerRegistry";
import type { LayerUserState } from "../state/workspaceStore";

export interface LayerRowViewProps {
  row: LayerRow;
  kind: LayerKind | undefined;
  state: LayerUserState;
  notInCompare: boolean;
  onState: (patch: Partial<LayerUserState>) => void;
  /** Move one place up (−1) or down (1) within the group. */
  onMove: (delta: -1 | 1) => void;
  onDropOn: (draggedKey: string) => void;
}

const DRAG_TYPE = "application/x-kestrel-layer";

/** One layer row (spec §5.2): grip, eye, swatch, name and badge, meta, opacity, extra controls, menu. */
export function LayerRowView({
  row,
  kind,
  state,
  notInCompare,
  onState,
  onMove,
  onDropOn,
}: LayerRowViewProps) {
  // F5: no ref read during render — a plain id derived from the row's key, not a ref.
  const describeId = `layer-nic-${row.key}`;
  if (row.unavailable) {
    return (
      <li
        data-testid="layer-row"
        data-kind={row.layer?.kind ?? "annotation"}
        data-id={row.id}
        className="grid grid-cols-[14px_minmax(0,1fr)] gap-2 rounded-sm px-1.5 py-1.5 opacity-45"
      >
        <span />
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">{row.name}</p>
          <p className="text-2xs text-muted">{row.unavailable.reason}</p>
          <Link to={row.unavailable.href} className="text-2xs text-accent-ink hover:underline">
            {row.unavailable.linkLabel}
          </Link>
        </div>
      </li>
    );
  }
  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    onMove(e.key === "ArrowUp" ? -1 : 1);
  };
  const onDragStart = (e: DragEvent<HTMLLIElement>) => e.dataTransfer.setData(DRAG_TYPE, row.key);
  const onDragOver = (e: DragEvent<HTMLLIElement>) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
  };
  const onDrop = (e: DragEvent<HTMLLIElement>) => {
    const key = e.dataTransfer.getData(DRAG_TYPE);
    if (key && key !== row.key) onDropOn(key);
  };
  const menu = kind?.menu?.(row) ?? [];
  const remove = menu.find((item) => item.id === "delete");
  const RowExtra = kind?.RowExtra;
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="layer-row"
      data-kind={row.layer?.kind ?? "annotation"}
      data-id={row.id}
      className={cx(
        "group/row grid grid-cols-[14px_28px_12px_minmax(0,1fr)_auto] items-start gap-1.5 rounded-sm px-1.5 py-1.5 hover:bg-hover",
        !state.visible && "opacity-45",
      )}
    >
      <button
        type="button"
        aria-label={`Move ${row.name}`}
        onKeyDown={onGripKey}
        className="mt-1 cursor-grab text-dim opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
      >
        <Icon name="grip" size={14} />
      </button>
      <IconButton
        size="sm"
        icon={state.visible ? "eye" : "eye-off"}
        label={`${state.visible ? "Hide" : "Show"} ${row.name}`}
        aria-pressed={state.visible}
        aria-describedby={notInCompare ? describeId : undefined}
        className={cx(notInCompare && "opacity-45")}
        onClick={() => onState({ visible: !state.visible })}
      />
      {notInCompare && (
        <span id={describeId} hidden>
          Not in compare
        </span>
      )}
      <span
        aria-hidden
        className="mt-1.5 h-3 w-3 rounded-sm border border-line bg-[var(--c)]"
        // --surface-2 is a complete rgba() (index.css), so it can stand in for a missing data colour.
        style={{ "--c": row.swatch ?? "var(--surface-2)" } as CSSProperties}
      />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm text-ink">
          <span className="truncate">{row.name}</span>
          {row.badge && (
            <Pill size="sm" tone="accent">
              {row.badge}
            </Pill>
          )}
        </p>
        <p className="truncate text-2xs text-muted">{row.meta}</p>
        {kind?.opacity !== false && (
          <Slider
            label={`${row.name} opacity`}
            min={0}
            max={100}
            step={1}
            value={state.opacity}
            showValue={false}
            onChange={(opacity) => onState({ opacity })}
            className="mt-1"
          />
        )}
        {RowExtra && (
          <RowExtra
            row={row}
            style={state.style ?? {}}
            setStyle={(patch) => onState({ style: { ...state.style, ...patch } })}
          />
        )}
      </div>
      <div className="flex items-start">
        {remove && (
          <IconButton size="sm" icon="trash" label={`Delete ${row.name}`} onClick={() => remove.onSelect()} />
        )}
        {menu.length > 0 ? (
          <MenuButton
            iconOnly
            icon="more"
            size="sm"
            variant="ghost"
            label={`${row.name} actions`}
            items={menu}
          />
        ) : (
          !remove && <span />
        )}
      </div>
    </li>
  );
}
