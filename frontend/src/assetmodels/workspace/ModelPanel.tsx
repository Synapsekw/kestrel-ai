import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AssetModel } from "@contract/client";
import { deleteAssetModel } from "@/api/assetModels";
import { useApi } from "@/api/client";
import { ConfirmDeleteDialog } from "@/mapws/layers/ConfirmDeleteDialog";
import { Button, Icon, IconButton, Pill, Popover, Switch, cx, focusRing, transition } from "@/ui";

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
  onImportGlb,
  onImportReview,
  onDeleted,
}: {
  projectId: string;
  model: AssetModel;
  models: readonly AssetModel[];
  onNew(): void;
  onDetails(): void;
  onImportGlb(): void;
  onImportReview(): void;
  onDeleted(model: AssetModel): void;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AssetModel | null>(null);
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
            <li key={m.id} className="flex items-center gap-0.5">
              <Link
                to={`/p/${projectId}/models/${m.id}`}
                onClick={() => setOpen(false)}
                aria-current={m.id === model.id ? "page" : undefined}
                className={cx(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1.5 text-sm",
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
              <IconButton
                size="sm"
                icon="trash"
                label={`Delete ${m.name}`}
                onClick={() => {
                  setOpen(false);
                  setPending(m);
                }}
              />
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
            icon="import"
            onClick={() => {
              setOpen(false);
              onImportGlb();
            }}
          >
            Import a GLB…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="findings"
            onClick={() => {
              setOpen(false);
              onImportReview();
            }}
          >
            Import inspection review…
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
      {pending && (
        <ConfirmDeleteDialog
          title="Are you sure?"
          body="Every version and its 3D model go with it. This can't be undone."
          onConfirm={async () => {
            await deleteAssetModel(api, projectId, pending.id);
            onDeleted(pending);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}

/**
 * The Model topic's body on the rail: the picker, a switch per part group present, the scan overlay
 * (it needs a run of this version that compared it with a cloud) and the view switches.
 */
export function ModelPanel({
  projectId,
  model,
  models,
  onNew,
  onDetails,
  onDeleted,
  groups,
  hiddenGroups,
  onGroup,
  overlay,
  overlayAvailable,
  onOverlay,
  view,
  onViewSwitch,
  groundAvailable,
  onImportGlb,
  onImportReview,
  children,
}: {
  projectId: string;
  model: AssetModel;
  models: readonly AssetModel[];
  onNew(): void;
  /** Opens the dialog to rename, re-tag or delete the shown model. */
  onDetails(): void;
  onDeleted(model: AssetModel): void;
  groups: readonly string[];
  hiddenGroups: ReadonlySet<string>;
  onGroup(group: string, visible: boolean): void;
  /** Null hides the switch (a model with no version has nothing to overlay). */
  overlay: boolean | null;
  overlayAvailable: boolean;
  onOverlay(on: boolean): void;
  view: { ghost: boolean; rotate: boolean; ground: boolean };
  onViewSwitch(k: "ghost" | "rotate" | "ground", on: boolean): void;
  /** False when the asset has no geographic origin, so there is no street map to show. */
  groundAvailable: boolean;
  onImportGlb(): void;
  onImportReview(): void;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid="model-panel"
      aria-label="Asset model"
      className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-1"
    >
      <ModelPicker
        projectId={projectId}
        model={model}
        models={models}
        onNew={onNew}
        onDetails={onDetails}
        onImportGlb={onImportGlb}
        onImportReview={onImportReview}
        onDeleted={onDeleted}
      />
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
      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <span className="text-xs text-muted">View</span>
        <Switch label="See through" checked={view.ghost} onChange={(on) => onViewSwitch("ghost", on)} />
        <Switch label="Turn slowly" checked={view.rotate} onChange={(on) => onViewSwitch("rotate", on)} />
        <Switch
          label="Street map"
          checked={view.ground && groundAvailable}
          disabled={!groundAvailable}
          onChange={(on) => onViewSwitch("ground", on)}
        />
        {!groundAvailable && (
          <p className="text-xs leading-relaxed text-muted">
            The street map needs the asset&apos;s location.
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
