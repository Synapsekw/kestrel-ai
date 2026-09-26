import { useRef, useState } from "react";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";
import { MenuButton } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";

export const title = "Popover and menu";
export const order = 90;

export default function PopoverSection() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <MenuButton
        variant="primary"
        icon="plus"
        label="Add data"
        items={[
          { id: "photos", label: "Photos", icon: "images", onSelect: () => {} },
          { id: "ortho", label: "Orthomosaic (GeoTIFF)", icon: "map", onSelect: () => {} },
          { id: "dsm", label: "Elevation (DSM/DTM)", icon: "elevation", onSelect: () => {} },
          { id: "cloud", label: "Point cloud (LAS/LAZ)", icon: "cloud", onSelect: () => {} },
          {
            id: "drawing",
            label: "Drawing",
            icon: "drawing",
            disabled: true,
            hint: "Arrives with the Maps workspace",
            onSelect: () => {},
          },
        ]}
      />
      <MenuButton
        iconOnly
        label="Row actions"
        items={[
          { id: "copy", label: "Copy link", icon: "external", shortcut: "Ctrl+Shift+C", onSelect: () => {} },
          { id: "delete", label: "Delete", icon: "trash", danger: true, onSelect: () => {} },
        ]}
      />
      <Button ref={anchor} icon="layers" onClick={() => setOpen((o) => !o)}>
        Layers
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        label="Layer settings"
        className="w-64 p-3"
      >
        <Field label="Name" htmlFor="g-layer">
          <Input id="g-layer" dense defaultValue="Ortho 2026-09-12" />
        </Field>
      </Popover>
    </div>
  );
}
