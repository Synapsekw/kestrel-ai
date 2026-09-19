import { Button, EmptyState } from "@/ui";

interface Props {
  /** True when filters (not an empty project) are the reason nothing is listed. */
  filtered: boolean;
  onImport: () => void;
  onClearFilters: () => void;
}

/** Centre-of-the-list empty state of the Images screen. */
export function EmptyImages({ filtered, onImport, onClearFilters }: Props) {
  if (filtered)
    return (
      <EmptyState
        icon="search"
        title="No images match the filters."
        action={<Button onClick={onClearFilters}>Clear filters</Button>}
      />
    );
  return (
    <EmptyState
      icon="images"
      title="This project has no images yet."
      action={
        <Button variant="primary" icon="import" onClick={onImport}>
          Import a folder of images
        </Button>
      }
    >
      Import a folder of aerial frames. The originals are never modified; the project keeps prepared copies.
    </EmptyState>
  );
}
