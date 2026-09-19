interface Props {
  /** True when filters (not an empty project) are the reason nothing is listed. */
  filtered: boolean;
  onImport: () => void;
  onClearFilters: () => void;
}

const action = "rounded bg-orange-600 px-3 py-1.5 text-sm font-medium hover:bg-orange-500";

/** Centre-of-the-list empty state of the Data Manager. */
export function EmptyImages({ filtered, onImport, onClearFilters }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      {filtered ? (
        <>
          <p className="text-sm text-slate-300">No images match the filters.</p>
          <button type="button" className={action} onClick={onClearFilters}>
            Clear filters
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-300">This project has no images yet.</p>
          <p className="max-w-md text-xs text-slate-400">
            Import a folder of aerial frames. The originals are never modified; the project keeps prepared
            copies.
          </p>
          <button type="button" className={action} onClick={onImport}>
            Import a folder of images
          </button>
        </>
      )}
    </div>
  );
}
