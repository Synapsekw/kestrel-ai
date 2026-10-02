import type { LayerRow } from "../layers/layerRegistry";
import type { ToolContext } from "../tools/toolStore";

/** What every map topic body receives from the workspace (spec §2). */
export interface MapTopicProps {
  rows: readonly LayerRow[];
  notInCompare: ReadonlySet<string>;
  projectId: string;
  context: ToolContext;
}
