import { useId, useState } from "react";
import { Checkbox, Disclosure, Field, Input } from "@/ui";
import { DEFAULT_QUERY_FORM, type QueryForm } from "./queryModel";

interface Props {
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
}

const numberInput = "w-28 tabular-nums";

/** True when a tiling value differs from the default, so the fold opens and nothing is hidden by surprise. */
function tilingChanged(form: QueryForm): boolean {
  return (
    form.tilingEnabled !== DEFAULT_QUERY_FORM.tilingEnabled ||
    form.tileSize !== DEFAULT_QUERY_FORM.tileSize ||
    form.overlap !== DEFAULT_QUERY_FORM.overlap ||
    form.nmsIou !== DEFAULT_QUERY_FORM.nmsIou
  );
}

/**
 * Spec section 8 tiling (default 1280 px, overlap 0.2, NMS IoU 0.5) folded under "Tiling", and the
 * confidence threshold, which stays in sight.
 */
export function TilingFields({ form, onChange }: Props) {
  const id = useId();
  const [openAtMount] = useState(() => tilingChanged(form));
  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Confidence"
        htmlFor={`${id}-conf`}
        hint="Boxes the model is less sure of than this are dropped."
      >
        <Input
          id={`${id}-conf`}
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={form.conf}
          onChange={(e) => onChange({ conf: e.target.value })}
          className={numberInput}
        />
      </Field>
      <Disclosure
        label="Tiling"
        defaultOpen={openAtMount}
        summary={form.tilingEnabled ? `${form.tileSize} px tiles` : "off"}
      >
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
          <Checkbox
            label="Tile large images"
            checked={form.tilingEnabled}
            onChange={(e) => onChange({ tilingEnabled: e.target.checked })}
          />
          <div className="flex flex-wrap items-start gap-4">
            <Field label="Tile size" htmlFor={`${id}-tile`}>
              <Input
                id={`${id}-tile`}
                type="number"
                min={256}
                max={4096}
                step={64}
                value={form.tileSize}
                disabled={!form.tilingEnabled}
                onChange={(e) => onChange({ tileSize: e.target.value })}
                className={numberInput}
              />
            </Field>
            <Field label="Overlap" htmlFor={`${id}-overlap`}>
              <Input
                id={`${id}-overlap`}
                type="number"
                min={0}
                max={0.5}
                step={0.05}
                value={form.overlap}
                disabled={!form.tilingEnabled}
                onChange={(e) => onChange({ overlap: e.target.value })}
                className={numberInput}
              />
            </Field>
            <Field label="NMS IoU" htmlFor={`${id}-nms`}>
              <Input
                id={`${id}-nms`}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={form.nmsIou}
                disabled={!form.tilingEnabled}
                onChange={(e) => onChange({ nmsIou: e.target.value })}
                className={numberInput}
              />
            </Field>
          </div>
          <p data-testid="tiling-note" className="max-w-2xl text-xs leading-relaxed text-muted">
            {form.tilingEnabled
              ? "Each image is cut into overlapping tiles so that small machines stay visible; boxes found twice in the overlap are merged. Slower, finds more."
              : form.kind === "local_model"
                ? `Without tiling the whole image is scaled down to ${form.tileSize} px before the model sees it, so small machines can disappear. (Pre-annotation in the editor uses 2560 px.)`
                : "Without tiling each image is sent once, as a whole: cheaper, but small machines are easily missed."}
          </p>
        </div>
      </Disclosure>
    </div>
  );
}
