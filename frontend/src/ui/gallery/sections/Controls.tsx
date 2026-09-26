import { useState } from "react";
import { Alert, Button, Checkbox, Field, IconButton, Input, Kbd, Pill, Select, Switch, Textarea } from "@/ui";

export const title = "Controls";
export const order = 20;

export default function ControlsSection() {
  const [suggestions, setSuggestions] = useState(true);
  const [reviewed, setReviewed] = useState(true);
  return (
    <div className="grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="plus">
          Add data
        </Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button size="sm">Small</Button>
        <IconButton icon="settings" label="Settings" />
        <Button disabled>Disabled</Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Project name" htmlFor="g-name" hint="Shown in the rail and on reports.">
          <Input id="g-name" placeholder="North quarry" />
        </Field>
        <Field label="Folder" htmlFor="g-folder" error="Choose an empty folder">
          <Input id="g-folder" invalid defaultValue="D:/Sites/north" />
        </Field>
        <Field label="Model" htmlFor="g-model">
          <Select id="g-model">
            <option>yolo11s</option>
            <option>yolo11m</option>
          </Select>
        </Field>
        <Field label="Note" htmlFor="g-note">
          <Textarea id="g-note" rows={3} placeholder="What did you see?" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <Checkbox label="Reviewed only" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        <Switch checked={suggestions} onChange={setSuggestions} label="Show suggestions" />
        <span className="flex items-center gap-1 text-sm text-muted">
          Palette <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill>neutral</Pill>
        <Pill tone="accent" live>
          running
        </Pill>
        <Pill tone="ok" dot>
          done
        </Pill>
        <Pill tone="warn">warning</Pill>
        <Pill tone="danger">failed</Pill>
        <Pill tone="info">reviewed</Pill>
        <Pill tone="inverse">inverse</Pill>
      </div>
      <div className="grid gap-2">
        <Alert title="Import finished">1,204 photos are ready.</Alert>
        <Alert tone="ok">Saved.</Alert>
        <Alert tone="warn">2 files had no GPS position.</Alert>
        <Alert tone="danger" title="Couldn't open the project">
          The folder is read-only.
        </Alert>
      </div>
    </div>
  );
}
