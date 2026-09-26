import { useState } from "react";
import { thumbnailUrl, type ImagePage } from "@contract/client";
import { useBackend } from "@/api/client";
import { Button, Checkbox } from "@/ui";
function Preview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="text-xs text-muted">No preview</span>
  ) : (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
export function FirstBatchPicker({
  projectId,
  page,
  selected,
  toggle,
  onPage,
  busy,
}: {
  projectId: string;
  page: ImagePage;
  selected: string[];
  toggle: (id: string) => void;
  onPage: (cursor?: string) => void;
  busy: boolean;
}) {
  const { baseUrl, token } = useBackend();
  return (
    <section aria-label="First labeling batch" className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold">Choose a small first batch</h3>
        <p className="mt-1 text-sm text-muted">
          {selected.length} of 24 selected. Browse one page at a time; selection is kept across pages.
        </p>
      </div>
      {page.items.length === 0 && (
        <p className="text-sm text-muted">No images are available yet. Import an image folder to continue.</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {page.items.map((img) => (
          <div key={img.id} className="min-w-0">
            <div className="mb-1.5 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-line bg-bg">
              <Preview key={img.id} src={thumbnailUrl(baseUrl, token, projectId, img.id)} />
            </div>
            <Checkbox
              checked={selected.includes(img.id)}
              aria-label={`Select ${img.file_name}`}
              onChange={() => toggle(img.id)}
              disabled={busy || (!selected.includes(img.id) && selected.length >= 24)}
              label={
                <span className="block max-w-28 truncate text-xs" title={img.file_name}>
                  {img.file_name}
                </span>
              }
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => onPage()}>
          Refresh images
        </Button>
        <Button
          size="sm"
          disabled={busy || !page.next_cursor}
          onClick={() => onPage(page.next_cursor ?? undefined)}
        >
          Next 24 images
        </Button>
      </div>
    </section>
  );
}
