import type { Block } from "@/api/reports";
import { ChartBlock } from "./ChartBlock";
import { CoverBlock } from "./CoverBlock";
import { FigureBlock } from "./FigureBlock";
import { FigureRowBlock } from "./FigureRowBlock";
import { FindingBlock } from "./FindingBlock";
import { HeadingBlock } from "./HeadingBlock";
import { KpisBlock } from "./KpisBlock";
import { KvBlock } from "./KvBlock";
import { PageBreakBlock } from "./PageBreakBlock";
import { ParaBlock } from "./ParaBlock";
import { TableBlock } from "./TableBlock";
import { VolumeBlock } from "./VolumeBlock";

function unknownBlock(block: never): null {
  void block;
  return null;
}

/** One component per block kind (spec §12 `preview/blocks/*`); a new kind fails to compile here. */
export function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      return <HeadingBlock block={block} />;
    case "para":
      return <ParaBlock block={block} />;
    case "kv":
      return <KvBlock block={block} />;
    case "kpis":
      return <KpisBlock block={block} />;
    case "table":
      return <TableBlock block={block} />;
    case "figure":
      return <FigureBlock block={block} />;
    case "figure_row":
      return <FigureRowBlock block={block} />;
    case "chart":
      return <ChartBlock block={block} />;
    case "finding":
      return <FindingBlock block={block} />;
    case "volume":
      return <VolumeBlock block={block} />;
    case "cover":
      return <CoverBlock block={block} />;
    case "page_break":
      return <PageBreakBlock />;
    default:
      return unknownBlock(block);
  }
}
