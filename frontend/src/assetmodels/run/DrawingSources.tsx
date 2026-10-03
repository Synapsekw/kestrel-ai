import type { AssetSourceRef } from "@contract/client";
import { Skeleton } from "@/ui";
import type { DrawingFile } from "./drawingFiles";
import { GroupHead, SourceRow } from "./SourceRows";

const ref = (id: string): AssetSourceRef => ({ type: "drawing", id });

export interface DrawingSourcesProps {
  files: DrawingFile[] | null;
  error: string | null;
  isChosen(ref: AssetSourceRef): boolean;
  onToggleFile(file: DrawingFile, on: boolean): void;
}

/** The project's drawings as whole files (plant-model spec §8.1: the picker selects whole files). */
export function DrawingSources({ files, error, isChosen, onToggleFile }: DrawingSourcesProps) {
  const picked = (f: DrawingFile) => f.drawings.filter((d) => isChosen(ref(d.id))).length;
  const chosenFiles = files?.filter((f) => picked(f) > 0).length ?? 0;
  return (
    <fieldset className="min-w-0">
      <GroupHead title="Drawings" chosen={chosenFiles} total={files?.length ?? null} />
      {files === null ? (
        <Skeleton className="h-7 w-full" />
      ) : error ? (
        <p className="text-xs text-danger">{`The list could not be loaded: ${error}`}</p>
      ) : files.length === 0 ? (
        <p className="px-1.5 text-xs text-dim">No drawings in this project.</p>
      ) : (
        <ul className="flex max-h-32 flex-col overflow-y-auto">
          {files.map((f) => {
            const n = picked(f);
            const usable = f.drawings.filter((d) => d.status !== "failed").length;
            return (
              <SourceRow
                key={f.key}
                label={f.label}
                meta={n > 0 && n < usable ? `${n} of ${usable} pages` : f.meta}
                status={f.status}
                checked={n > 0}
                onChange={(on) => onToggleFile(f, on)}
              />
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
