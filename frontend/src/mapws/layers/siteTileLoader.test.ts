import { beforeEach, describe, expect, it, vi } from "vitest";
import TileState from "ol/TileState";
import { classifyTileStatus, makeSiteTileLoader } from "./siteTileLoader";

function fakeTile() {
  const img = document.createElement("img");
  return { img, tile: { getImage: () => img, setState: vi.fn() } };
}
const res = (status: number) =>
  ({ status, blob: async () => new Blob(["png"]) }) as unknown as Response;

describe("site tile loader (W2-9)", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:tile");
    URL.revokeObjectURL = vi.fn();
  });

  it("classifies statuses", () => {
    expect(classifyTileStatus(200)).toBe("image");
    expect(classifyTileStatus(204)).toBe("empty");
    expect(classifyTileStatus(404)).toBe("gone");
    expect(classifyTileStatus(410)).toBe("gone");
    expect(classifyTileStatus(500)).toBe("error");
  });

  it("puts a 200 into the tile image through an object URL and frees it on load", async () => {
    const { img, tile } = fakeTile();
    makeSiteTileLoader(vi.fn(), async () => res(200))(
      tile as never,
      "http://t",
    );
    await vi.waitFor(() => expect(img.src).toBe("blob:tile"));
    img.dispatchEvent(new Event("load"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tile");
    expect(tile.setState).not.toHaveBeenCalled();
  });

  it("empties a 204 tile and reports a 404", async () => {
    const onGone = vi.fn();
    const a = fakeTile();
    makeSiteTileLoader(onGone, async () => res(204))(
      a.tile as never,
      "http://t",
    );
    await vi.waitFor(() =>
      expect(a.tile.setState).toHaveBeenCalledWith(TileState.EMPTY),
    );
    const b = fakeTile();
    makeSiteTileLoader(onGone, async () => res(404))(
      b.tile as never,
      "http://t",
    );
    await vi.waitFor(() =>
      expect(b.tile.setState).toHaveBeenCalledWith(TileState.ERROR),
    );
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("marks a network failure as a tile error without reporting it gone", async () => {
    const onGone = vi.fn();
    const { tile } = fakeTile();
    makeSiteTileLoader(onGone, async () =>
      Promise.reject(new Error("offline")),
    )(tile as never, "http://t");
    await vi.waitFor(() =>
      expect(tile.setState).toHaveBeenCalledWith(TileState.ERROR),
    );
    expect(onGone).not.toHaveBeenCalled();
  });
});
