import TileState from "ol/TileState";
import type ImageTile from "ol/ImageTile";
import type Tile from "ol/Tile";

export type TileOutcome = "image" | "empty" | "gone" | "error";

/** Ruling W2-9. */
export function classifyTileStatus(status: number): TileOutcome {
  if (status === 200) return "image";
  if (status === 204) return "empty";
  if (status === 404 || status === 410) return "gone";
  return "error";
}

/**
 * An OpenLayers `tileLoadFunction` that fetches the tile so it can see the status an `<img>` hides
 * (deviation 7): 204 is an empty tile outside the footprint; 404/410 means the layer is gone.
 */
export function makeSiteTileLoader(
  onGone: () => void,
  fetchImpl: typeof fetch = fetch,
) {
  return (tile: Tile, src: string): void => {
    const image = (tile as ImageTile).getImage() as HTMLImageElement;
    fetchImpl(src)
      .then(async (res) => {
        const outcome = classifyTileStatus(res.status);
        if (outcome === "image") {
          const url = URL.createObjectURL(await res.blob());
          const done = () => URL.revokeObjectURL(url);
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
          image.src = url;
          return;
        }
        tile.setState(outcome === "empty" ? TileState.EMPTY : TileState.ERROR);
        if (outcome === "gone") onGone();
      })
      .catch(() => tile.setState(TileState.ERROR));
  };
}
