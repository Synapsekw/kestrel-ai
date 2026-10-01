import { useRef, useState } from "react";
import type { CatalogueType } from "@/api/catalogue";
import { Button, ComboboxList, Popover, type ComboItem } from "@/ui";

/** "Add from Catalogue": the Combobox list over the catalogue types not yet in the list. */
export function CataloguePicker({
  items,
  unavailable,
  loading,
  onPick,
}: {
  items: readonly CatalogueType[];
  unavailable: string | null;
  loading: boolean;
  onPick: (t: CatalogueType) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  // No `hotkey` on the items: typing filters, it never picks a type by its catalogue hotkey.
  const combo: ComboItem[] = items.map((t) => ({
    id: t.id,
    label: t.name,
    colour: t.colour,
    hint: t.kind === "defect" ? "Defect" : "Object",
  }));
  return (
    <>
      <Button
        ref={anchor}
        icon="plus"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={unavailable !== null || loading}
        onClick={() => setOpen((o) => !o)}
      >
        Add from Catalogue
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Add from Catalogue">
        <ComboboxList
          label="Catalogue types"
          items={combo}
          value={null}
          placeholder="Filter types"
          emptyText="Every catalogue type is already in the list"
          onSelect={(id) => {
            setOpen(false);
            const t = items.find((x) => x.id === id);
            if (t) onPick(t);
          }}
        />
      </Popover>
    </>
  );
}
