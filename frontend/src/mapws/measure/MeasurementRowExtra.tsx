import { Checkbox } from "@/ui";
import { useWorkspace, type LayerRowExtraProps } from "@/mapws/annotations/bindings";
import { KIND_LABEL } from "@/mapws/annotations/format";
import { measureFilters, measurementsMeta } from "./layerFeatures";
import { useMeasurementsStore } from "./store";

const KINDS = ["distance", "area", "profile"] as const;

/** The row's live count and its kind filter (W3-9, W3-19). */
export function MeasurementRowExtra({ style, setStyle }: LayerRowExtraProps) {
  const items = useMeasurementsStore((s) => s.items);
  const truncated = useMeasurementsStore((s) => s.truncated);
  const r = useWorkspace((s) => s.r);
  const surveys = useWorkspace((s) => s.surveys);
  // M-W3 A3: a merged survey lists its maps, not map ids.
  const rMapIds = surveys.find((s) => s.date === r)?.maps.map((m) => m.id) ?? [];
  const { kinds } = measureFilters(style);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-2xs text-muted">{measurementsMeta(items, truncated, rMapIds)}</p>
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="sr-only">Show</legend>
        {KINDS.map((k) => (
          <Checkbox
            key={k}
            label={KIND_LABEL[k]}
            checked={kinds.includes(k)}
            onChange={() =>
              setStyle({
                kinds: kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k],
              })
            }
          />
        ))}
      </fieldset>
    </div>
  );
}
