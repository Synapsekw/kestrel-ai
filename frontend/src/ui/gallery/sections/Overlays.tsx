import { useState } from "react";
import { Button, Dialog, Field, Input, Tooltip } from "@/ui";

export const title = "Overlays";
export const order = 40;

export default function OverlaysSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Tooltip label="Box" shortcut="B" side="right">
        <Button>Right, with a key</Button>
      </Tooltip>
      <Tooltip label="Annotations" shortcut="Shift+H">
        <Button>Top, with a chord</Button>
      </Tooltip>
      <Tooltip label="Opens to the left" side="left">
        <Button>Left</Button>
      </Tooltip>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open a dialog
      </Button>
      <Dialog
        open={open}
        title="New project"
        description="A project holds photos, maps, elevation and point clouds."
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Create
            </Button>
          </>
        }
      >
        <Field label="Name" htmlFor="g-project">
          <Input id="g-project" placeholder="North quarry" />
        </Field>
      </Dialog>
    </div>
  );
}
