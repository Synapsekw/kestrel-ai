import { useState } from "react";
import { SeverityPicker, SeverityPill } from "@/ui/Severity";
import { StatusDot } from "@/ui/StatusDot";
import { TypeChip } from "@/ui/TypeChip";

export const title = "Severity and status";
export const order = 70;

export default function SeveritySection() {
  const [level, setLevel] = useState<number | null>(3);
  const [fallback, setFallback] = useState<number | null>(null);
  return (
    <div className="grid max-w-xl gap-6">
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((l) => (
          <SeverityPill key={l} level={l} />
        ))}
        <SeverityPill level={null} />
        <SeverityPill level={5} />
      </div>
      <div className="w-[292px]">
        <SeverityPicker value={level} onChange={setLevel} />
      </div>
      <div className="w-[292px]">
        <SeverityPicker label="Default severity" value={fallback} onChange={setFallback} allowNone />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
        {(["open", "reviewed", "closed", "idle", "failed"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <StatusDot status={s} />
            {s}
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <StatusDot status="running" live />
          running (live)
        </span>
      </div>
      <div className="flex flex-wrap gap-4">
        <TypeChip name="Crack" colour="#ff5a4f" kind="defect" />
        <TypeChip name="Spalling" colour="#ff9c3a" kind="defect" />
        <TypeChip name="Excavator" colour="#8aa4ff" kind="object" />
        <TypeChip name="Old truck" colour="#a7a6c4" kind="object" archived />
      </div>
    </div>
  );
}
