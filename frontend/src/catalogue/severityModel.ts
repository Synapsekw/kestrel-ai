import type { SeverityInUse, SeverityLevel } from "@/api/catalogue";

/** Keys 1–9 grade a finding (F §5.6), so the scale has at most nine levels (plan decision 3). */
export const MAX_LEVELS = 9;

/** Colours for appended levels; the first four are D4's defaults (F §4.1). */
export const LEVEL_PALETTE = [
  "#3fb68e",
  "#e2bf2e",
  "#ff9c3a",
  "#ff5a4f",
  "#c2185b",
  "#7b1fa2",
  "#4527a0",
  "#283593",
  "#1565c0",
];

/** Sample open-finding counts for the preview bars, lowest level first. */
export const PREVIEW_COUNTS = [12, 7, 4, 2, 1, 1, 1, 1, 1];

export function appendLevel(levels: SeverityLevel[]): SeverityLevel[] {
  if (levels.length >= MAX_LEVELS) return levels;
  const level = levels.length + 1;
  return [...levels, { level, name: `Level ${level}`, colour: LEVEL_PALETTE[level - 1] }];
}

/** Only the highest level can go (F §7.2); the server refuses it while findings use it. */
export function removeTopLevel(levels: SeverityLevel[]): SeverityLevel[] {
  return levels.length <= 1 ? levels : levels.slice(0, -1);
}

export function validateLevels(levels: SeverityLevel[]): string | null {
  if (levels.length === 0) return "The scale needs at least one level.";
  if (levels.length > MAX_LEVELS) return `The scale has at most ${MAX_LEVELS} levels.`;
  for (const l of levels) {
    if (!l.name.trim()) return `Give level ${l.level} a name.`;
    if (!/^#[0-9a-f]{6}$/i.test(l.colour)) return `Choose a colour for level ${l.level}.`;
  }
  const names = levels.map((l) => l.name.trim().toLowerCase());
  const dupAt = names.findIndex((n, i) => names.indexOf(n) !== i);
  if (dupAt >= 0)
    return `Two levels are called "${levels[dupAt].name.trim()}". Give each level its own name.`;
  return null;
}

export function toLevels(levels: SeverityLevel[]): SeverityLevel[] {
  return levels.map((l, i) => ({ level: i + 1, name: l.name.trim(), colour: l.colour }));
}

/** 409 `severity_in_use` as a sentence; `levels` is the saved scale, which still has the level. */
export function severityInUseMessage(info: SeverityInUse, levels: SeverityLevel[]): string {
  const name = levels.find((l) => l.level === info.level)?.name;
  const label = name ? `Level ${info.level} (${name})` : `Level ${info.level}`;
  const where = info.projects.length > 0 ? info.projects.join(", ") : "an open project";
  return `${label} is still used by open findings in ${where}. Regrade or close them, then remove the level.`;
}
