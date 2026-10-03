import type { AssetSourceRef } from "@contract/client";
import type { UnimportedDrawing } from "@/api/drawings";
import { Button, Skeleton } from "@/ui";
import type { DrawingFile } from "./drawingFiles";
import { GroupHead, SourceRow } from "./SourceRows";

const ref = (id: string): AssetSourceRef => ({ type: "drawing", id });

export interface DrawingSourcesProps {
  files: DrawingFile[] | null;
  error: string | null;
  isChosen(ref: AssetSourceRef): boolean;
  onToggleFile(file: DrawingFile, on: boolean): void;
  unimported: UnimportedDrawing[] | null;
  unimportedError: string | null;
  /** The path being imported; the other rows wait (one import at a time). */
  importing: string | null;
  importErrors: Record<string, string>;
  onImport(file: UnimportedDrawing): void;
}

function unimportedMeta(f: UnimportedDrawing): string {
  const kind = f.format.toUpperCase();
  return f.pages && f.pages > 1 ? `${kind} · ${f.pages} pages` : kind;
}

/** The project's drawings as whole files (plant-model spec §8.1: the picker selects whole files). */
export function DrawingSources({
  files,
  error,
  isChosen,
  onToggleFile,
  unimported,
  unimportedError,
  importing,
  importErrors,
  onImport,
}: DrawingSourcesProps) {
  const picked = (f: DrawingFile) => f.drawings.filter((d) => isChosen(ref(d.id))).length;
  const chosenFiles = files?.filter((f) => picked(f) > 0).length ?? 0;
  return (
    <fieldset className="min-w-0">
      <GroupHead title="Drawings" chosen={chosenFiles} total={files?.length ?? null} />
      {files === null ? (
        <Skeleton className="h-7 w-full" />
      ) : error ? (
        <p className="text-xs text-danger">{`The list could not be loaded: ${error}`}</p>
      ) : files.length === 0 && !unimported?.length ? (
        <p className="px-1.5 text-xs text-dim">No drawings in this project.</p>
      ) : (
        files.length > 0 && (
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
        )
      )}
      {unimported && unimported.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="mb-1 px-1.5 text-2xs font-medium text-muted">Not imported yet</p>
          <ul aria-label="Not imported yet" className="flex max-h-32 flex-col overflow-y-auto">
            {unimported.map((f) => (
              <li key={f.path} className="flex flex-col rounded-sm px-1.5 hover:bg-hover">
                <div className="flex min-h-7 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={f.path}>
                    {f.name}
                  </span>
                  <span className="shrink-0 font-mono text-2xs tabular-nums text-dim">
                    {unimportedMeta(f)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="import"
                    aria-label={`Import and include ${f.name}`}
                    loading={importing === f.path}
                    disabled={importing !== null && importing !== f.path}
                    onClick={() => onImport(f)}
                  >
                    Import and include
                  </Button>
                </div>
                {importErrors[f.path] && <p className="pb-1 text-xs text-danger">{importErrors[f.path]}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unimportedError && (
        <p className="mt-1 px-1.5 text-xs text-dim">{`Files not imported yet could not be listed: ${unimportedError}`}</p>
      )}
    </fieldset>
  );
}
