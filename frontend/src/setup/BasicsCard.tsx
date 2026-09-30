import { FolderField } from "@/screens/projects/FolderField";
import { Field, Input } from "@/ui";
import { useSetupDraft } from "./draftStore";
import { SetupCard } from "./SetupCard";

/** Card 2: the name and folder the New project dialog had (F §9.2); the checks live in the summary. */
export function BasicsCard() {
  const name = useSetupDraft((s) => s.name);
  const folder = useSetupDraft((s) => s.folder);
  const setName = useSetupDraft((s) => s.setName);
  const setFolder = useSetupDraft((s) => s.setFolder);
  return (
    <SetupCard n={2} title="Basics">
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <Field label="Name" htmlFor="project-name">
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Site name or campaign"
          />
        </Field>
        <FolderField
          id="project-folder"
          label="Folder"
          value={folder}
          onChange={setFolder}
          hint="A new or empty folder. Imported data is copied here; the originals are never touched."
        />
      </div>
    </SetupCard>
  );
}
