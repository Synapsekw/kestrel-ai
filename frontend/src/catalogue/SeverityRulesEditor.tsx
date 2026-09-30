import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconButton, Input, Select, useSeverityScale } from "@/ui";
import {
  MAX_RULES,
  MAX_WHEN,
  moveRule,
  newRuleKey,
  newRuleLevel,
  onScale,
  type RuleDraft,
} from "./severityRulesModel";

export interface SeverityRulesEditorProps {
  rules: RuleDraft[];
  onChange: (rules: RuleDraft[]) => void;
  /** Where a new rule starts when the scale has it (plan ruling 3). */
  defaultSeverity: number | null;
}

interface PendingFocus {
  /** The rule whose condition takes focus when `el` cannot. */
  key: string | null;
  /** The control that triggered a move; re-focused because React may move the focused node. */
  el: HTMLElement | null;
}

/** The type's ordered severity rules (S1 §5, §8): condition, level from the scale, move, remove. */
export function SeverityRulesEditor({ rules, onChange, defaultSeverity }: SeverityRulesEditorProps) {
  const scale = useSeverityScale();
  const list = useRef<HTMLOListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const pending = useRef<PendingFocus | null>(null);
  const [announce, setAnnounce] = useState("");

  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    if (p.el && p.el.isConnected && !p.el.matches(":disabled")) {
      p.el.focus();
      return;
    }
    const row = p.key ? list.current?.querySelector<HTMLElement>(`[data-rule-key="${p.key}"]`) : null;
    (row?.querySelector<HTMLElement>("input") ?? addButton.current)?.focus();
  });

  const update = (i: number, p: Partial<RuleDraft>) =>
    onChange(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const move = (i: number, delta: -1 | 1, el: HTMLElement | null) => {
    const to = i + delta;
    if (to < 0 || to >= rules.length) return;
    pending.current = { key: rules[i].key, el };
    onChange(moveRule(rules, i, to));
    setAnnounce(`Rule moved to position ${to + 1} of ${rules.length}`);
  };

  const add = () => {
    const key = newRuleKey();
    pending.current = { key, el: null };
    onChange([...rules, { key, when: "", severity: newRuleLevel(defaultSeverity, scale) }]);
  };

  const remove = (i: number) => {
    const next = rules[i + 1] ?? rules[i - 1] ?? null;
    pending.current = { key: next?.key ?? null, el: null };
    onChange(rules.filter((_, j) => j !== i));
    setAnnounce(`Rule ${i + 1} removed`);
  };

  const onRowKeyDown = (i: number) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    move(i, e.key === "ArrowUp" ? -1 : 1, e.target instanceof HTMLElement ? e.target : null);
  };

  return (
    <div className="flex flex-col gap-3">
      {rules.length > 0 ? (
        <ol ref={list} aria-label="Severity rules" className="flex flex-col gap-2">
          {rules.map((r, i) => {
            const n = i + 1;
            const stale = !onScale(r.severity, scale);
            const staleId = `severity-rule-${r.key}-stale`;
            return (
              <li
                key={r.key}
                data-rule-key={r.key}
                onKeyDown={onRowKeyDown(i)}
                className="flex flex-col gap-1.5 rounded-control border border-line p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
                    {n}
                  </span>
                  <Input
                    dense
                    aria-label={`Rule ${n} condition`}
                    placeholder="For example: wider than 5 mm"
                    maxLength={MAX_WHEN}
                    value={r.when}
                    onChange={(e) => update(i, { when: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-1 pl-6">
                  <Select
                    dense
                    aria-label={`Rule ${n} severity`}
                    invalid={stale}
                    aria-describedby={stale ? staleId : undefined}
                    wrapperClassName="min-w-0 flex-1"
                    value={String(r.severity)}
                    onChange={(e) => update(i, { severity: Number(e.target.value) })}
                  >
                    {stale && <option value={r.severity}>{`Level ${r.severity} (removed)`}</option>}
                    {scale.map((l) => (
                      <option key={l.level} value={l.level}>
                        {`${l.level} ${l.name}`}
                      </option>
                    ))}
                  </Select>
                  <IconButton
                    size="sm"
                    icon="chevron-down"
                    label={`Move rule ${n} up`}
                    className="[&_svg]:rotate-180"
                    disabled={i === 0}
                    onClick={(e) => move(i, -1, e.currentTarget)}
                  />
                  <IconButton
                    size="sm"
                    icon="chevron-down"
                    label={`Move rule ${n} down`}
                    disabled={i === rules.length - 1}
                    onClick={(e) => move(i, 1, e.currentTarget)}
                  />
                  <IconButton size="sm" icon="trash" label={`Remove rule ${n}`} onClick={() => remove(i)} />
                </div>
                {stale && (
                  <p id={staleId} className="pl-6 text-xs text-danger">
                    {`Level ${r.severity} is no longer on the severity scale. Choose another level.`}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-xs text-muted">
          No rules yet. Add one to say which severity fits which condition.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button ref={addButton} size="sm" icon="plus" disabled={rules.length >= MAX_RULES} onClick={add}>
          Add rule
        </Button>
        <span className="text-xs text-muted">{`${rules.length} of ${MAX_RULES}`}</span>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
