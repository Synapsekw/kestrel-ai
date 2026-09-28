import { formatChord, keysFor } from "@/ui/keymap";

export interface Hint {
  keys: string[];
  help: string;
}

/** The mockup's default strip, read from F's keymap by action: V B P S L Space ←→ 1–n. */
const DEFAULTS: [string[], string][] = [
  [["tool-select"], "select"],
  [["box"], "box"],
  [["polygon"], "polygon"],
  [["smart-polygon"], "smart"],
  [["measure-length"], "measure"],
  [["pan-hold"], "pan"],
  [["previous-image", "next-image"], "image"],
];

/** §6.4: FC's `statusHintsFor(tool)` line for the active tool; with none, the workspace defaults. */
export function statusHints(toolText: string, scaleSize: number): Hint[] {
  if (toolText.trim()) return [{ keys: [], help: toolText }];
  const all = keysFor("images");
  const hints = DEFAULTS.map(([actions, help]) => ({
    keys: actions.flatMap(
      (a) =>
        all
          .find((e) => e.action === a)
          ?.keys.slice(0, 1)
          .flatMap(formatChord) ?? [],
    ),
    help,
  })).filter((h) => h.keys.length > 0);
  return [...hints, { keys: [`1–${scaleSize}`], help: "severity" }];
}

export function reviewedCount(flags: readonly number[]): number {
  let n = 0;
  for (const f of flags) if (f & 1) n++;
  return n;
}
