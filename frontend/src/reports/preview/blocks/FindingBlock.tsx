import type { BlockOf } from "@/api/reports";
import { PRINT, findingLabel, mm, pt, textStyle } from "../../printTheme";
import { usePreviewEnv } from "../PreviewContext";
import { AssetDrawingSvg } from "./AssetDrawingSvg";
import { FigureBlock } from "./FigureBlock";
import { FigureRowBlock } from "./FigureRowBlock";
import { KvBlock } from "./KvBlock";
import { Label, SeverityMark, TypeSwatch } from "./marks";
import { ParaBlock } from "./ParaBlock";

const STATUS: Record<string, string> = { open: "Open", reviewed: "Reviewed", closed: "Closed" };
const photoName = (f: BlockOf<"figure">, i: number) => `Photo ${i + 1}${f.caption ? `: ${f.caption}` : ""}`;

/** One finding page (spec §7.3): head band, main + secondary figures, kv, note, photos, comments. */
export function FindingBlock({ block }: { block: BlockOf<"finding"> }) {
  const label = findingLabel(block.number);
  const [main, ...secondary] = block.figures;
  const head = block.head;
  const headFill = usePreviewEnv().brand?.headFill ?? PRINT.head;
  const asset = block.asset ?? null;
  return (
    <article data-block="finding" aria-label={`${label} ${head.type_name}`}>
      {asset?.kicker ? (
        <p data-kicker style={{ ...textStyle(PRINT.size.small, PRINT.muted), margin: `0 0 ${mm(1)}` }}>
          {asset.kicker}
        </p>
      ) : null}
      <header
        className="flex flex-wrap items-center justify-between"
        style={{
          background: headFill,
          borderRadius: mm(2),
          padding: `${mm(2.5)} ${mm(3)}`,
          marginBottom: mm(3),
          gap: mm(2),
        }}
      >
        <p
          className="flex items-center"
          style={{ ...textStyle(PRINT.size.h3), fontWeight: 600, gap: mm(1.5), margin: 0 }}
        >
          <span className="font-mono tabular-nums" style={{ fontSize: pt(PRINT.size.h3) }}>
            {label}
          </span>
          <span aria-hidden="true">·</span>
          <TypeSwatch colour={head.type_colour} />
          {head.type_name}
        </p>
        <p className="flex items-center" style={{ ...textStyle(PRINT.size.body), gap: mm(3), margin: 0 }}>
          <SeverityMark
            level={head.severity_level ?? null}
            name={head.severity_name ?? null}
            colour={head.severity_colour ?? null}
          />
          <span>{STATUS[head.status] ?? head.status}</span>
        </p>
      </header>
      {main ? <FigureBlock block={main} /> : null}
      {secondary.length > 0 ? <FigureRowBlock block={{ kind: "figure_row", figures: secondary }} /> : null}
      {asset?.height_locator ? (
        <div
          className="grid items-start"
          style={{ gridTemplateColumns: `${mm(22)} 1fr`, gap: mm(0), marginTop: mm(3) }}
        >
          <AssetDrawingSvg drawing={asset.height_locator} label="Height on the asset" widthMm={18} />
          {block.kv.length > 0 ? <KvBlock block={{ kind: "kv", rows: block.kv }} /> : <span />}
        </div>
      ) : block.kv.length > 0 ? (
        <KvBlock block={{ kind: "kv", rows: block.kv }} />
      ) : null}
      {block.note ? <ParaBlock block={{ kind: "para", text: block.note, style: "note" }} /> : null}
      {block.photos.length > 0 ? (
        <>
          <Label>Photos</Label>
          <FigureRowBlock block={{ kind: "figure_row", figures: block.photos }} altOf={photoName} />
        </>
      ) : null}
      {block.comments.length > 0 ? (
        <>
          <Label>Comments</Label>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {block.comments.map((c, i) => (
              <li
                key={i}
                style={{
                  ...textStyle(PRINT.size.comment),
                  padding: `${mm(1)} 0`,
                  borderTop: `${mm(0.2)} solid ${PRINT.rule}`,
                }}
              >
                <p className="font-mono" style={{ ...textStyle(PRINT.size.small, PRINT.muted), margin: 0 }}>
                  {`${c.author} · ${c.created_at.slice(0, 10)}`}
                </p>
                <p style={{ margin: 0, whiteSpace: "pre-line" }}>{c.text}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}
