/**
 * The client mirror of the backend's `normalise_name` (F §7.1): casefold, trim, `_` and `-` become
 * spaces, runs of spaces collapse to one, so "dump_truck" and "Dump truck" are the same type. The
 * server stays the authority (409 `type_exists`); this only lets the UI say so before sending.
 */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}
