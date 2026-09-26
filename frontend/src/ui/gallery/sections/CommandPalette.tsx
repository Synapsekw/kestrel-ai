import { useState } from "react";
import { Button } from "@/ui/Button";
import { CommandPalette, type Command, type CommandSource } from "@/ui/CommandPalette";

export const title = "Command palette";
export const order = 120;

const noop = () => {};

const FINDINGS: Command[] = [
  { id: "f217", title: "F-0217 Crack", hint: "DJI_0412.JPG · Major", icon: "findings", run: noop },
  { id: "f218", title: "F-0218 Spalling", hint: "North ortho · Moderate", icon: "findings", run: noop },
];

const SOURCES: CommandSource[] = [
  {
    id: "findings",
    label: "Findings",
    search: (q, signal) =>
      new Promise((resolve, reject) => {
        const t = window.setTimeout(
          () => resolve(FINDINGS.filter((f) => f.title.toLowerCase().includes(q.toLowerCase()))),
          300,
        );
        signal.addEventListener("abort", () => {
          window.clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  },
];

export default function CommandPaletteSection() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="search" onClick={() => setOpen(true)}>
        Open the palette
      </Button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        sources={SOURCES}
        groups={[
          {
            label: "Go to",
            items: [
              { id: "projects", title: "Projects", icon: "folder", run: noop },
              { id: "models", title: "Models", icon: "models", run: noop },
              { id: "catalogue", title: "Catalogue", icon: "catalogue", run: noop },
              { id: "jobs", title: "Jobs", icon: "jobs", run: noop },
            ],
          },
          {
            label: "Actions",
            items: [
              { id: "add", title: "Add data", icon: "plus", run: noop },
              { id: "effects", title: "Toggle reduced effects", icon: "sparkle", run: noop },
              { id: "shortcuts", title: "Keyboard shortcuts", icon: "keyboard", shortcut: "?", run: noop },
            ],
          },
        ]}
      />
    </>
  );
}
