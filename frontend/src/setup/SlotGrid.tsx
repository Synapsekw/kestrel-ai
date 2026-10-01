import { useEffect, useState } from "react";
import { Button, Disclosure, Icon, IconButton, MenuButton, Pill, cx, type MenuItem } from "@/ui";
import type { TemplateSlot } from "./api";
import { useSetupDraft, type DraftBucket } from "./draftStore";
import {
  ROUTE_ICON,
  VIDEO_NOTE,
  bucketLabel,
  countLabel,
  sizeLabel,
  skippedBuckets,
  slotFills,
  unusedBuckets,
  type SlotFill,
} from "./model";
import { canMoveTo } from "./remap";

/**
 * The template's slots with their buckets, then the buckets no slot takes, the skipped ones and what
 * was not recognised. A bucket moves by its grip (pointer events, Ruling 1) or by its Move menu.
 */
export function SlotGrid({ onBrowse }: { onBrowse?: (slot: TemplateSlot) => void }) {
  const slots = useSetupDraft((s) => s.slots);
  const buckets = useSetupDraft((s) => s.buckets);
  const notRecognised = useSetupDraft((s) => s.notRecognised);
  const moveBucket = useSetupDraft((s) => s.moveBucket);
  const skipBucket = useSetupDraft((s) => s.skipBucket);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragged = dragId ? (buckets.find((b) => b.id === dragId) ?? null) : null;

  useEffect(() => {
    if (!dragId) return;
    // A slot's own pointerup runs first (React listens on the root, inside document); this ends any drag.
    const end = () => setDragId(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    document.addEventListener("pointerup", end);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerup", end);
      document.removeEventListener("keydown", onKey);
    };
  }, [dragId]);

  const dropOn = (slotKey: string | null) => {
    if (!dragged) return;
    const slot = slotKey ? slots.find((s) => s.key === slotKey) : undefined;
    if (slot && !canMoveTo(dragged, slot)) return;
    moveBucket(dragged.id, slotKey);
  };

  const moves = (b: DraftBucket): MenuItem[] => [
    ...slots
      .filter((s) => s.key !== b.slot_key && canMoveTo(b, s))
      .map((s) => ({ id: `to-${s.key}`, label: `To ${s.label}`, onSelect: () => moveBucket(b.id, s.key) })),
    ...(b.slot_key !== null
      ? [{ id: "unused", label: "Not used", onSelect: () => moveBucket(b.id, null) }]
      : []),
    { id: "skip", label: "Skip", onSelect: () => skipBucket(b.id) },
  ];

  const unused = unusedBuckets(buckets);
  const skipped = skippedBuckets(buckets);

  return (
    <div className={cx("flex flex-col gap-3", dragId && "select-none")}>
      {slots.length === 0 ? (
        <p className="text-sm text-muted">
          Blank has no data slots. Choose a template to sort data into slots, or add data later from the
          project&apos;s tabs.
        </p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 min-[1100px]:grid-cols-3">
          {slotFills(slots, buckets).map((fill) => (
            <SlotTile
              key={fill.slot.key}
              fill={fill}
              dragged={dragged}
              onDrop={() => dropOn(fill.slot.key)}
              onBrowse={onBrowse}
              moves={moves}
              onDragStart={setDragId}
            />
          ))}
        </div>
      )}
      {unused.length > 0 && (
        <section
          aria-label="Not used by this template"
          onPointerUp={() => dropOn(null)}
          className="flex flex-col gap-1.5 rounded-control border border-line p-3"
        >
          <h3 className="text-xs font-medium text-muted">Not used by this template</h3>
          <ul className="flex flex-col gap-1">
            {unused.map((b) => (
              <BucketRow key={b.id} bucket={b} moves={moves(b)} onDragStart={setDragId} />
            ))}
          </ul>
        </section>
      )}
      {skipped.length > 0 && (
        <section
          aria-label="Skipped"
          className="flex flex-col gap-1.5 rounded-control border border-line p-3"
        >
          <h3 className="text-xs font-medium text-muted">Skipped</h3>
          <ul className="flex flex-col gap-1">
            {skipped.map((b) => (
              <BucketRow key={b.id} bucket={b} onRestore={() => skipBucket(b.id, false)} />
            ))}
          </ul>
        </section>
      )}
      {notRecognised.count > 0 && (
        <Disclosure
          label={`${notRecognised.count.toLocaleString("en-GB")} ${notRecognised.count === 1 ? "file" : "files"} not recognised`}
        >
          <ul aria-label="Not recognised" className="flex flex-col gap-1 text-xs">
            {notRecognised.samples.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex gap-2">
                <span className="font-mono text-ink">{s.name}</span>
                <span className="text-muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

function SlotTile({
  fill,
  dragged,
  onDrop,
  onBrowse,
  moves,
  onDragStart,
}: {
  fill: SlotFill;
  dragged: DraftBucket | null;
  onDrop: () => void;
  onBrowse?: (slot: TemplateSlot) => void;
  moves: (b: DraftBucket) => MenuItem[];
  onDragStart: (id: string) => void;
}) {
  const { slot, buckets, count, bytes } = fill;
  const target = dragged !== null && dragged.slot_key !== slot.key;
  const fits = target && canMoveTo(dragged, slot);
  return (
    <section
      aria-label={slot.label}
      data-slot={slot.key}
      onPointerUp={onDrop}
      className={cx(
        "flex min-w-0 flex-col gap-2 rounded-control border bg-surface p-3 transition-colors duration-fast ease-out reduce-motion:transition-none",
        fits ? "border-accent bg-accent-soft" : buckets.length > 0 ? "border-ok/25" : "border-line",
        target && !fits && "opacity-50",
      )}
    >
      <header className="flex items-start gap-2">
        <Icon name={ROUTE_ICON[slot.route]} size={15} className="mt-0.5 text-muted" />
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-ink">{slot.label}</h3>
        {slot.required && (
          <Pill size="sm" tone={buckets.length > 0 ? "neutral" : "warn"}>
            Required
          </Pill>
        )}
      </header>
      <p className="flex flex-wrap gap-1">
        {slot.accepts.map((x) => (
          <span key={x} className="rounded-chip bg-surface-2 px-1.5 font-mono text-2xs text-muted">
            .{x}
          </span>
        ))}
      </p>
      {slot.route === "video" && <p className="text-xs text-warn">{VIDEO_NOTE}</p>}
      {buckets.length > 0 ? (
        <>
          <ul className="flex flex-col gap-1">
            {buckets.map((b) => (
              <BucketRow key={b.id} bucket={b} moves={moves(b)} onDragStart={onDragStart} />
            ))}
          </ul>
          <p className="flex items-center justify-between gap-2 text-xs text-muted">
            <span className="tabular-nums">{`${countLabel({ route: slot.route, count })} · ${sizeLabel(bytes)}`}</span>
            <Pill size="sm" tone="ok">
              Ready
            </Pill>
          </p>
        </>
      ) : (
        <p className="text-xs text-muted">{onBrowse ? "Drop files or browse" : "Nothing sorted here yet"}</p>
      )}
      {onBrowse && slot.route !== "video" && (
        <Button
          size="sm"
          variant="ghost"
          icon="folder"
          aria-label={`Browse for ${slot.label}`}
          onClick={() => onBrowse(slot)}
          className="self-start"
        >
          Browse
        </Button>
      )}
    </section>
  );
}

function BucketRow({
  bucket,
  moves,
  onDragStart,
  onRestore,
}: {
  bucket: DraftBucket;
  moves?: MenuItem[];
  onDragStart?: (id: string) => void;
  onRestore?: () => void;
}) {
  const label = bucketLabel(bucket);
  return (
    <li
      aria-label={label}
      className="flex min-w-0 items-center gap-1.5 rounded-sm bg-surface-2 px-1.5 py-1 text-xs"
    >
      {onDragStart && (
        <IconButton
          icon="grip"
          size="sm"
          label={`Drag ${label}`}
          className="cursor-grab"
          onPointerDown={(e) => {
            e.preventDefault();
            onDragStart(bucket.id);
          }}
        />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-ink" title={bucket.folder}>
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-muted">{`${countLabel(bucket)} · ${sizeLabel(bucket.bytes)}`}</span>
      {moves && (
        <MenuButton iconOnly icon="more" size="sm" variant="ghost" label={`Move ${label}`} items={moves} />
      )}
      {onRestore && (
        <Button size="sm" variant="ghost" onClick={onRestore}>
          Use again
        </Button>
      )}
    </li>
  );
}
