import { Checkbox } from "@/ui";
import type { LayerRowExtraProps } from "@/mapws/annotations/bindings";
import { CATEGORY_LABEL, ZONE_CATEGORIES, zoneFilters } from "./categories";
import { useZonesStore } from "./store";

/** The zones row's live count and category filter (W3-9, W3-19). */
export function ZonesRowExtra({ style, setStyle }: LayerRowExtraProps) {
  const count = useZonesStore((s) => s.items.length);
  const { categories } = zoneFilters(style);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-2xs text-muted">
        {count === 0 ? "None yet" : count === 1 ? "1 zone" : `${count} zones`}
      </p>
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="sr-only">Category</legend>
        {ZONE_CATEGORIES.map((c) => (
          <Checkbox
            key={c}
            label={CATEGORY_LABEL[c]}
            checked={categories.includes(c)}
            onChange={() =>
              setStyle({
                categories: categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c],
              })
            }
          />
        ))}
      </fieldset>
    </div>
  );
}
