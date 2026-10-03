import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { drawingThumbnailUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { Button, Popover } from "@/ui";

const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;

/**
 * "Source opens drawing crop" (plan Ruling 10): no crop endpoint exists, so this shows the drawing's
 * thumbnail with the traced region outlined, the page when it has one, and a way into Maps.
 */
export function SourcePopover({
  projectId,
  drawingId,
  page,
  region,
}: {
  projectId: string;
  drawingId: string;
  page: number | null;
  region: readonly number[] | null;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const { baseUrl, token } = useBackend();
  const box = region && region.length >= 4 ? region : null;
  return (
    <>
      <span ref={anchor} className="inline-grid">
        <Button
          size="sm"
          variant="secondary"
          icon="drawing"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Source
        </Button>
      </span>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        label="Source"
        side="left"
        align="start"
      >
        <div className="flex w-64 flex-col gap-2 p-1">
          <div className="relative overflow-hidden rounded-sm bg-bg">
            <img
              src={drawingThumbnailUrl(baseUrl, token, projectId, drawingId)}
              alt="The drawing this item was traced from"
              className="block w-full"
            />
            {box && (
              <span
                data-testid="source-region"
                aria-hidden="true"
                className="absolute rounded-sm border-2 border-accent"
                style={{
                  left: pct(box[0]),
                  top: pct(box[1]),
                  width: pct(box[2] - box[0]),
                  height: pct(box[3] - box[1]),
                }}
              />
            )}
          </div>
          {page != null && <p className="text-2xs text-muted">{`Page ${page}`}</p>}
          <Link
            className="text-xs text-accent-ink underline-offset-2 hover:underline"
            to={`/p/${projectId}/maps?sel=drawing:${drawingId}`}
          >
            Open the drawing in Maps
          </Link>
        </div>
      </Popover>
    </>
  );
}
