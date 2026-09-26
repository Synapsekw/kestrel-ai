import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exampleCloud } from "@/test/cloudFixtures";
import { MapContextMenu } from "./MapContextMenu";

const menu = { x: 10, y: 20, px: 100, py: 200 };

describe("MapContextMenu", () => {
  it("offers the one linked cloud as a menu item", async () => {
    const onOpen = vi.fn();
    render(
      <MapContextMenu menu={menu} clouds={[exampleCloud]} georeferenced onOpen={onOpen} onClose={() => {}} />,
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Open this spot in 3D" }));
    expect(onOpen).toHaveBeenCalledWith(exampleCloud);
  });

  it("names each cloud when several are linked", () => {
    const b = { ...exampleCloud, id: "b", name: "Second flight" };
    render(
      <MapContextMenu
        menu={menu}
        clouds={[exampleCloud, b]}
        georeferenced
        onOpen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "Open this spot in 3D: Second flight" })).toBeInTheDocument();
  });

  it("tells a georeferenced map to link a cloud, and a map without coordinates that it cannot", () => {
    const { rerender } = render(
      <MapContextMenu menu={menu} clouds={[]} georeferenced onOpen={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/Link a point cloud to this map/)).toBeInTheDocument();
    rerender(
      <MapContextMenu menu={menu} clouds={[]} georeferenced={false} onOpen={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/This map has no coordinates/)).toBeInTheDocument();
    expect(screen.queryByText(/Link a point cloud/)).toBeNull();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<MapContextMenu menu={menu} clouds={[]} georeferenced onOpen={() => {}} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
