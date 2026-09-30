import type { BlockOf } from "@/api/reports";
import { mm } from "../../printTheme";
import { FigureBlock } from "./FigureBlock";

export function FigureRowBlock({
  block,
  altOf,
}: {
  block: BlockOf<"figure_row">;
  altOf?: (figure: BlockOf<"figure">, index: number) => string;
}) {
  return (
    <div data-block="figure_row" className="flex flex-wrap items-start" style={{ gap: `0 ${mm(4)}` }}>
      {block.figures.map((f, i) => (
        <FigureBlock key={`${i}-${f.snapshot.key}`} block={f} alt={altOf?.(f, i)} />
      ))}
    </div>
  );
}
