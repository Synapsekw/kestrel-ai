import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { getAssetItem, type AssetItem } from "@/api/plantItems";
import { Alert, Button, Pill, Skeleton } from "@/ui";
import { HEIGHT_SOURCE, flagText, footprintRef, metres } from "./itemFormat";
import { confidenceLabel } from "./labels";
import { SourcePopover } from "./SourcePopover";

const CONFIDENCE = { high: "ok", medium: "neutral", low: "warn" } as const;
/** Every AssetPartSource.kind in the contract. */
const SOURCE_KIND: Record<string, string> = {
  drawing: "Drawing",
  cloud: "Point cloud",
  photo: "Photo",
  assumed: "Assumed",
  operator: "Edited by hand",
};

/** Spec §11 Item (right, on selection): the register row, its flags, its source, and Edit. */
export function ItemPanel(p: {
  projectId: string;
  modelId: string;
  version: number;
  itemId: string;
  onBack(): void;
  onEdit(item: AssetItem): void;
  /** Why Edit waits (a saved version still building or loading); null or absent when it can start. */
  editBlocked?: string | null;
}) {
  const api = useApi();
  const key = `${p.modelId}/${p.version}/${p.itemId}`;
  const [loaded, setLoaded] = useState<{ key: string; item: AssetItem | null; error: string | null } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    getAssetItem(api, p.projectId, p.modelId, p.version, p.itemId).then(
      (item) => alive && setLoaded({ key, item, error: null }),
      (e: unknown) =>
        alive && setLoaded({ key, item: null, error: messageOf(e, "The item could not be loaded.") }),
    );
    return () => {
      alive = false;
    };
  }, [api, p.projectId, p.modelId, p.version, p.itemId, key]);
  const current = loaded?.key === key ? loaded : null;
  const item = current?.item ?? null;
  const flags = item?.flags ?? [];

  return (
    <section aria-label="Item" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div>
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={p.onBack}>
          Register
        </Button>
      </div>
      {current?.error && (
        <Alert tone="danger" title="The item could not be loaded.">
          {current.error}
        </Alert>
      )}
      {!current && (
        <div role="status" aria-label="Loading the item" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full rounded-sm" />
        </div>
      )}
      {item && (
        <>
          <header className="flex flex-col gap-0.5">
            <p className={item.tag ? "font-mono text-xs text-muted" : "text-xs text-dim"}>
              {item.tag ?? "Untagged"}
            </p>
            <h2 className="text-lg font-semibold text-ink">{item.name}</h2>
          </header>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Type</dt>
            <dd className="text-ink">{item.type.replace(/_/g, " ")}</dd>
            <dt className="text-muted">Area</dt>
            <dd className="text-ink">{item.area ?? "not set"}</dd>
            <dt className="text-muted">Plant</dt>
            <dd className="font-mono tabular-nums text-ink">
              {(() => {
                const at = footprintRef(item.footprint);
                return at ? `E ${at[0].toFixed(2)} · N ${at[1].toFixed(2)}` : "Not set";
              })()}
            </dd>
            <dt className="text-muted">Base EL</dt>
            <dd className="font-mono tabular-nums text-ink">{metres(item.base_el)}</dd>
            <dt className="text-muted">Top EL</dt>
            <dd className="font-mono tabular-nums text-ink">{metres(item.top_el)}</dd>
            <dt className="text-muted">Height</dt>
            <dd>
              <Pill size="sm" tone={HEIGHT_SOURCE[item.height_source]?.tone ?? "neutral"}>
                {HEIGHT_SOURCE[item.height_source]?.label ?? item.height_source}
              </Pill>
            </dd>
            <dt className="text-muted">Confidence</dt>
            <dd>
              <Pill size="sm" tone={CONFIDENCE[item.confidence as keyof typeof CONFIDENCE] ?? "neutral"}>
                {confidenceLabel(item.confidence)}
              </Pill>
            </dd>
          </dl>
          {flags.length > 0 && (
            <ul aria-label="Flags" className="flex flex-col gap-1">
              {flags.map((f, i) => (
                <li key={i} className="rounded-sm bg-warn-soft px-2 py-1 text-xs text-ink">
                  {flagText(f)}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {item.source.kind === "drawing" && item.source.id ? (
              <SourcePopover
                projectId={p.projectId}
                drawingId={item.source.id}
                page={item.source.page ?? null}
                region={item.source.region ?? null}
              />
            ) : (
              <span className="text-xs text-muted">
                Source <span className="text-ink">{SOURCE_KIND[item.source.kind] ?? item.source.kind}</span>
              </span>
            )}
            <Button
              size="sm"
              variant="primary"
              icon="label"
              className="ml-auto"
              disabled={!!p.editBlocked}
              onClick={() => p.onEdit(item)}
            >
              Edit
            </Button>
          </div>
          {p.editBlocked && <p className="text-xs text-muted">{p.editBlocked}</p>}
          {item.notes && <p className="text-xs leading-relaxed text-muted">{item.notes}</p>}
        </>
      )}
    </section>
  );
}
