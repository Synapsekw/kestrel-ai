import type { AddDataTile } from "@/app/addDataStore";
import { Button, Tooltip, type ButtonProps } from "@/ui";
import { ADD_DATA_LOADING, openAddData, useAddDataReady } from "./addDataTiles";

export interface AddDataButtonProps extends Omit<ButtonProps, "onClick" | "disabled"> {
  projectId: string;
  /** The importer to open; none shows the dialog's tiles. */
  tile?: AddDataTile;
}

/**
 * The gated Add data button every empty state uses (SH's gate): disabled with "Project is still
 * loading" until the shell has loaded `projectId`, then it opens the dialog for that project.
 */
export function AddDataButton({ projectId, tile, children, ...rest }: AddDataButtonProps) {
  const ready = useAddDataReady(projectId);
  if (ready)
    return (
      <Button {...rest} onClick={() => openAddData(tile)}>
        {children}
      </Button>
    );
  return (
    <Tooltip label={ADD_DATA_LOADING}>
      <Button {...rest} disabled>
        {children}
      </Button>
    </Tooltip>
  );
}
