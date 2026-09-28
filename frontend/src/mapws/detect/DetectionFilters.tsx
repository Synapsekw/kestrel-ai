import { useProjectTypes } from "@/findings/useProjectTypes";
import { useWorkspaceStores } from "@/mapws/w4host";
import { Checkbox, Switch } from "@/ui";
import { useDetectStore } from "./detectStore";

/** Under the AI detections row (spec §5.2): pending / accepted / findings / rejected, types, all surveys (R-W4-5). */
export function DetectionFilters() {
  const { projectId } = useWorkspaceStores();
  const { all } = useProjectTypes(projectId);
  const f = useDetectStore((s) => s.filters);
  const set = useDetectStore((s) => s.setFilters);
  const toggleType = (id: string) => {
    const next = new Set(f.hiddenTypes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ hiddenTypes: next });
  };
  return (
    <div className="flex flex-col gap-1.5 pt-1" aria-label="Detection filters">
      <Checkbox label="Pending" checked={f.pending} onChange={(e) => set({ pending: e.target.checked })} />
      <Checkbox
        label="Accepted objects"
        checked={f.accepted}
        onChange={(e) => set({ accepted: e.target.checked })}
      />
      <Checkbox
        label="Accepted defects (findings)"
        checked={f.findings}
        onChange={(e) => set({ findings: e.target.checked })}
      />
      <Checkbox label="Rejected" checked={f.rejected} onChange={(e) => set({ rejected: e.target.checked })} />
      {all.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
          {all.map((t) => (
            <Checkbox
              key={t.id}
              label={t.name}
              checked={!f.hiddenTypes.has(t.id)}
              onChange={() => toggleType(t.id)}
            />
          ))}
        </div>
      )}
      <Switch label="All surveys" checked={f.allSurveys} onChange={(on) => set({ allSurveys: on })} />
    </div>
  );
}
