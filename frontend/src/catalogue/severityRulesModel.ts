import type { SeverityRule } from "@/api/catalogue";
import type { SeverityLevel } from "@/ui";

/** S1 §5: at most 8 rules, a condition of at most 200 characters, a definition of at most 1000. */
export const MAX_RULES = 8;
export const MAX_WHEN = 200;
export const MAX_DEFINITION = 1000;

/** A rule being edited; `key` keeps React's row identity (and focus) through a reorder. */
export interface RuleDraft {
  key: string;
  when: string;
  severity: number;
}

let seq = 0;

export function newRuleKey(): string {
  seq += 1;
  return `r${seq}`;
}

/** A catalogue from before migration 0003 answers without the list: that reads as no rules. */
export function rulesOf(rules: readonly SeverityRule[] | null | undefined): RuleDraft[] {
  return (rules ?? []).map((r) => ({ key: newRuleKey(), when: r.when, severity: r.severity }));
}

export function toRules(drafts: readonly RuleDraft[]): SeverityRule[] {
  return drafts.map((d) => ({ when: d.when.trim(), severity: d.severity }));
}

/** Same order, same trimmed conditions, same levels. */
export function sameRules(a: readonly SeverityRule[], b: readonly SeverityRule[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.when.trim() === b[i].when.trim() && r.severity === b[i].severity)
  );
}

export function moveRule(drafts: readonly RuleDraft[], from: number, to: number): RuleDraft[] {
  const next = [...drafts];
  if (from === to || to < 0 || to >= drafts.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function onScale(level: number, scale: readonly SeverityLevel[]): boolean {
  return scale.some((s) => s.level === level);
}

/** The type's default severity when the scale has it; otherwise the lowest level. */
export function newRuleLevel(defaultSeverity: number | null, scale: readonly SeverityLevel[]): number {
  if (defaultSeverity !== null && onScale(defaultSeverity, scale)) return defaultSeverity;
  return scale[0]?.level ?? 1;
}

/** The first problem, named by rule number, or null. */
export function validateRules(drafts: readonly RuleDraft[], scale: readonly SeverityLevel[]): string | null {
  if (drafts.length > MAX_RULES) return `Keep to ${MAX_RULES} rules or fewer.`;
  for (const [i, d] of drafts.entries()) {
    const n = i + 1;
    const when = d.when.trim();
    if (!when) return `Rule ${n} needs a condition. Say when it applies, or remove it.`;
    if (when.length > MAX_WHEN) return `Keep rule ${n} to ${MAX_WHEN} characters or fewer.`;
    if (!onScale(d.severity, scale)) {
      return `Rule ${n} uses level ${d.severity}, which is no longer on the severity scale. Choose another level.`;
    }
  }
  return null;
}
