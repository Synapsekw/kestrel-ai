import { useEffect, useId } from "react";
import { create } from "zustand";
import type { Command } from "@/ui";

export type CommandGroup = "Go to" | "Actions";

export interface CommandEntry {
  key: string;
  group: CommandGroup;
  commands: readonly Command[];
}

interface Registry {
  entries: CommandEntry[];
  put: (entry: CommandEntry) => void;
  remove: (key: string) => void;
}

/** Commands screens add to the palette (spec 2026-09-26-foundation section 5.4). */
export const useCommandRegistry = create<Registry>((set) => ({
  entries: [],
  put: (entry) => set((s) => ({ entries: [...s.entries.filter((e) => e.key !== entry.key), entry] })),
  remove: (key) => set((s) => ({ entries: s.entries.filter((e) => e.key !== key) })),
}));

/** The commands of `group` in registration order; a later command with the same id replaces an earlier one. */
export function collectCommands(entries: readonly CommandEntry[], group: CommandGroup): Command[] {
  const byId = new Map<string, Command>();
  for (const entry of entries) {
    if (entry.group !== group) continue;
    for (const command of entry.commands) {
      byId.delete(command.id);
      byId.set(command.id, command);
    }
  }
  return [...byId.values()];
}

/**
 * Adds a screen's commands to the palette while the screen is mounted. Pass a memoised array: a
 * new array re-registers, which is cheap but re-renders the palette.
 */
export function useCommands(commands: readonly Command[], group: CommandGroup = "Actions"): void {
  const key = useId();
  useEffect(() => {
    useCommandRegistry.getState().put({ key, group, commands });
  }, [key, group, commands]);
  useEffect(() => () => useCommandRegistry.getState().remove(key), [key]);
}
