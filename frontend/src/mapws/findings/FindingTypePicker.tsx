import { useApi } from "@/api/client";
import { addProjectType } from "@/catalogue/addProjectType";
import { NameAnomalyField } from "@/catalogue/NameAnomalyField";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { ComboboxList, SkeletonRows } from "@/ui";

/** Spec §5.1: F's Combobox over the project's defect types; type hotkeys are live inside it. */
export function FindingTypePicker({
  projectId,
  onPick,
}: {
  projectId: string;
  onPick: (typeId: string) => void;
}) {
  const api = useApi();
  const { loaded, defectTypes } = useProjectTypes(projectId);
  if (!loaded)
    return (
      <div className="w-[280px] p-2">
        <SkeletonRows rows={3} columns={1} />
      </div>
    );
  return (
    <div className="flex w-[280px] flex-col gap-2 p-2">
      {defectTypes.length === 0 ? (
        <p className="text-sm text-muted">This project has no defect types yet. Name one to mark it here.</p>
      ) : (
        <ComboboxList
          label="Finding type"
          placeholder="Filter, or press a type's key…"
          value={null}
          onSelect={onPick}
          items={defectTypes.map((t) => ({
            id: t.id,
            label: t.name,
            colour: t.colour,
            hotkey: t.hotkey,
            hint: t.group ?? undefined,
          }))}
        />
      )}
      <NameAnomalyField
        onCreate={async (name) => {
          const added = await addProjectType(api, projectId, name, "defect");
          onPick(added.typeId);
        }}
      />
    </div>
  );
}
