export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * Follows `next_cursor` until it is null. Stops early when a cursor repeats (the Prism mock answers
 * `next_cursor: "string"` on every list page) or after `maxPages`, and dedupes items by id so a
 * repeated page never doubles the list.
 */
export async function collectPages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  maxPages = 50,
): Promise<T[]> {
  const seenCursors = new Set<string>();
  const byId = new Map<string, T>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    for (const item of result.items) if (!byId.has(item.id)) byId.set(item.id, item);
    const next = result.next_cursor;
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return [...byId.values()];
}
