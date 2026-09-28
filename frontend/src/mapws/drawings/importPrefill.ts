/** The Re-import path (R-W5-11): set by the row menu or the inspector, read once by the next dialog. */
let prefill: string | null = null;

export function setImportPrefill(path: string | null): void {
  prefill = path;
}

export function takeImportPrefill(): string | null {
  const p = prefill;
  prefill = null;
  return p;
}
