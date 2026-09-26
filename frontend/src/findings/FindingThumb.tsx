import { useState, type CSSProperties } from "react";
import { useBackend } from "@/api/client";
import { findingThumbnailUrl, type Finding } from "@/api/findings";

/** 44 × 32 lazy crop (F §8.6); a failed or missing crop shows the type colour as an outline. */
export function FindingThumb({
  projectId,
  finding,
  colour,
}: {
  projectId: string;
  finding: Finding;
  colour: string;
}) {
  const { baseUrl, token } = useBackend();
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative grid h-8 w-11 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-2"
      style={{ "--c": colour } as CSSProperties}
    >
      {failed ? (
        <span
          aria-hidden
          className="absolute inset-x-2.5 inset-y-1.5 rounded-sm border-2 border-[color:var(--c)]"
        />
      ) : (
        <img
          src={findingThumbnailUrl(baseUrl, token, projectId, finding.id)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}
