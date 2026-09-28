import { ComboboxList, SkeletonRows } from "@/ui";
import { useProjectTypes } from "@/findings/useProjectTypes";

/** Spec §5.1: F's Combobox over the project's defect types; type hotkeys are live inside it. */
export function FindingTypePicker({
  projectId,
  onPick,
}: {
  projectId: string;
  onPick: (typeId: string) => void;
}) {
  const { loaded, defectTypes } = useProjectTypes(projectId);
  if (!loaded)
    return (
      <div className="w-[280px] p-2">
        <SkeletonRows rows={3} columns={1} />
      </div>
    );
  if (defectTypes.length === 0)
    return (
      <p className="w-[280px] p-3 text-sm text-muted">
        This project has no defect types yet. Add one in the Catalogue.
      </p>
    );
  return (
    <div className="p-2">
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
    </div>
  );
}
