import type { SnapshotRef } from "@/api/reports";
import { ReportPreview } from "@/reports/ReportPreview";
import { FIXTURE_OUTLINE, fixtureLoader } from "@/reports/preview/fixtures";

export const title = "Report preview";
export const order = 200;

const loader = fixtureLoader();

/** A stand-in snapshot (the gallery has no backend): the cover gradient at 4:3. */
function standInSnapshot(ref: SnapshotRef): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><defs><linearGradient id="g" x1="0" x2="1">` +
    `<stop offset="0" stop-color="#3B2A7A"/><stop offset="1" stop-color="#0F5B66"/></linearGradient></defs>` +
    `<rect width="4" height="3" fill="url(#g)"/><text x="0.2" y="2.8" font-size="0.3" fill="#fff">${ref.key}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A stand-in asset (the gallery has no backend): a white-on-violet "ACME" wordmark, for the cover logo chip. */
function standInAsset(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 110">` +
    `<rect width="220" height="110" fill="#6A5CFF"/>` +
    `<text x="110" y="66" font-family="sans-serif" font-size="44" font-weight="700" fill="#fff" ` +
    `text-anchor="middle">ACME</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export default function ReportPreviewSection() {
  return (
    <div className="h-[720px] overflow-hidden rounded-panel border border-line">
      <ReportPreview
        projectId="gallery"
        outline={FIXTURE_OUTLINE}
        loadBlocks={loader}
        resolveSnapshot={standInSnapshot}
        resolveAsset={standInAsset}
        pageCount={8}
      />
    </div>
  );
}
