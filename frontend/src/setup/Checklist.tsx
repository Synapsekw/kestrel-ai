import type { ReactNode } from "react";
import { Icon, Pill, type PillTone } from "@/ui";
import { SORTING_TEXT, wholeFolderText, type ChecklistModel } from "./model";

/** Spec §8 Summary: template, name and folder, "n of m slots" with a line per empty required slot, types, clashes. */
export function Checklist({ model }: { model: ChecklistModel }) {
  return (
    <ul aria-label="Setup checklist" className="flex flex-col gap-2 text-sm text-ink">
      <Item tone="ok">{`Template: ${model.templateName}`}</Item>
      <Item tone={model.basics ? "warn" : "ok"}>{model.basics ?? "Name and folder"}</Item>
      {model.slotsTotal > 0 && (
        <Item
          tone={model.emptyRequired.length > 0 ? "warn" : "ok"}
          mark={`${model.slotsFilled}/${model.slotsTotal}`}
        >
          {`${model.slotsFilled} of ${model.slotsTotal} slots`}
        </Item>
      )}
      {model.emptyRequired.map((s) => (
        <Item key={s.key} tone="warn">{`${s.label} is empty. You can add it later.`}</Item>
      ))}
      <Item tone="accent" mark={String(model.typeCount)}>
        {`${model.typeCount} anomaly ${model.typeCount === 1 ? "type" : "types"}`}
      </Item>
      {model.wholeFolders.map((name) => (
        <Item key={`whole-${name}`} tone="warn">
          {wholeFolderText(name)}
        </Item>
      ))}
      {model.sorting && <Item tone="warn">{SORTING_TEXT}</Item>}
      {model.clashes.map((c) => (
        <Item key={c} tone="danger">
          {c}
        </Item>
      ))}
      {model.rulesProblems.map((p) => (
        <Item key={p} tone="danger">
          {p}
        </Item>
      ))}
    </ul>
  );
}

function Item({ tone, mark, children }: { tone: PillTone; mark?: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Pill size="sm" tone={tone} aria-hidden="true" className="min-w-7 justify-center tabular-nums">
        {mark ?? <Icon name={tone === "ok" ? "check" : "warning"} size={11} />}
      </Pill>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}
