import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AssetModel } from "@contract/client";
import { Button, GlassPanel, Icon, Pill, Popover, Switch, cx, focusRing, stagger, transition } from "@/ui";

const TONE = { empty: "neutral", building: "accent", ready: "ok" } as const;

/** "name · tag · v2", the picker's one-line identity of a model. */
function identity(m: AssetModel): string {
  return [m.name, m.tag, m.current_version != null ? `v${m.current_version}` : null]
    .filter(Boolean)
    .join(" · ");
}

function ModelPicker({
  projectId,
  model,
  models,
  onNew,
  onDetails,
}: {
  projectId: string;
  model: AssetModel;
  models: readonly AssetModel[];
  onNew(): void;
  onDetails(): void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const sub = [
    model.asset_type,
    model.current_version != null ? `version ${model.current_version}` : "no version yet",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Asset model: ${identity(model)}. Choose another`}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-control border border-line bg-field px-2.5 py-2 text-left hover:border-line-strong",
          transition,
          focusRing,
        )}
      >
        <span
          aria-hidden
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-sm bg-grad-primary text-accent-fg"
        >
          <Icon name="cube" size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {model.name}
            {model.tag && <span className="font-mono font-normal text-muted"> · {model.tag}</span>}
          </span>
          <span className="block truncate text-xs text-muted">{sub}</span>
        </span>
        <Icon name="chevron-down" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        label="Asset models"
        className="w-[300px] p-2"
      >
        <ul aria-label="Asset models" className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {models.map((m) => (
            <li key={m.id}>
              <Link
                to={`/p/${projectId}/models/${m.id}`}
                onClick={() => setOpen(false)}
                aria-current={m.id === model.id ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2 rounded-control px-2 py-1.5 text-sm",
                  transition,
                  focusRing,
                  m.id === model.id ? "bg-accent-soft" : "hover:bg-hover",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {[m.tag, m.current_version != null ? `v${m.current_version}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <Pill size="sm" tone={TONE[m.status]}>
                  {m.status}
                </Pill>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              setOpen(false);
              onNew();
            }}
          >
            New asset model…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="settings"
            onClick={() => {
              setOpen(false);
              onDetails();
            }}
          >
            Details…
          </Button>
        </div>
      </Popover>
    </>
  );
}

/**
 * The model panel (left 72, top 14, width 282, like the cloud panel): the picker, a switch per part
 * group present, and the scan overlay, which needs a run of this version that compared it with a cloud.
 */
export function ModelPanel({
  projectId,
  model,
  models,
  onNew,
  onDetails,
  groups,
  hiddenGroups,
  onGroup,
  overlay,
  overlayAvailable,
  onOverlay,
  children,
}: {
  projectId: string;
  model: AssetModel;
  models: readonly AssetModel[];
  onNew(): void;
  /** Opens the dialog to rename, re-tag or delete the shown model. */
  onDetails(): void;
  groups: readonly string[];
  hiddenGroups: ReadonlySet<string>;
  onGroup(group: string, visible: boolean): void;
  /** Null hides the switch (a model with no version has nothing to overlay). */
  overlay: boolean | null;
  overlayAvailable: boolean;
  onOverlay(on: boolean): void;
  children?: ReactNode;
}) {
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      as="section"
      aria-label="Asset model"
      data-testid="model-panel"
      style={stagger(1)}
      className="stagger absolute left-[72px] top-3.5 z-10 flex max-h-[calc(100%-28px)] w-[282px] flex-col gap-[11px] overflow-y-auto p-3 animate-reveal reduce-motion:animate-none"
    >
      <ModelPicker projectId={projectId} model={model} models={models} onNew={onNew} onDetails={onDetails} />
      {groups.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Groups</span>
          <ul aria-label="Part groups" className="flex flex-col gap-1.5">
            {groups.map((g) => (
              <li key={g}>
                <Switch
                  className="w-full"
                  label={g}
                  checked={!hiddenGroups.has(g)}
                  onChange={(visible) => onGroup(g, visible)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {overlay !== null && (
        <div className="flex flex-col gap-1 border-t border-line pt-2.5">
          <Switch
            label="Show scan overlay"
            checked={overlay}
            disabled={!overlayAvailable}
            onChange={onOverlay}
          />
          {!overlayAvailable && (
            <p className="text-xs leading-relaxed text-muted">
              Available once a build compares this version with a scan.
            </p>
          )}
        </div>
      )}
      {children}
    </GlassPanel>
  );
}
