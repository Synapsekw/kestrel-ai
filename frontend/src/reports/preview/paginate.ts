import type { Block } from "@/api/reports";

export interface Sheet {
  id: string;
  kind: "flow" | "finding" | "cover";
  blocks: Block[];
}

/**
 * Ruling 7: a flow sheet ends at a page break; each finding is a page of its own (spec §7.3).
 * Ruling R-6: a `cover` block is also a page of its own, on sheet kind `"cover"`.
 */
export function paginate(sectionKey: string, blocks: readonly Block[]): Sheet[] {
  const sheets: Sheet[] = [];
  let flow: Block[] = [];
  const flush = () => {
    if (flow.length === 0) return;
    sheets.push({ id: `${sectionKey}-${sheets.length}`, kind: "flow", blocks: flow });
    flow = [];
  };
  for (const b of blocks) {
    if (b.kind === "page_break") flush();
    else if (b.kind === "finding") {
      flush();
      sheets.push({ id: `finding-${b.finding_id}`, kind: "finding", blocks: [b] });
    } else if (b.kind === "cover") {
      flush();
      sheets.push({ id: `cover-${sectionKey}-${sheets.length}`, kind: "cover", blocks: [b] });
    } else flow.push(b);
  }
  flush();
  return sheets;
}
