import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Surface } from "@contract/client";
import { exampleSurface } from "@/test/volumeFixtures";
import { SurfaceList } from "./SurfaceList";

const design: Surface = {
  ...exampleSurface,
  id: "s-design",
  name: "Final levels",
  kind: "design",
  measurement_count: 0,
};

function renderList(surfaces: Surface[], onDelete = vi.fn()) {
  render(
    <SurfaceList
      surfaces={surfaces}
      activeId={null}
      onSelect={() => {}}
      onBuild={() => {}}
      onRebuild={() => {}}
      onDelete={onDelete}
    />,
  );
  return onDelete;
}

describe("SurfaceList", () => {
  it("offers Delete on a ready design surface, after a confirmation", () => {
    const onDelete = renderList([exampleSurface, design]);
    const rows = within(screen.getByRole("list", { name: "Surfaces" })).getAllByRole("listitem");
    expect(within(rows[0]).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete Final levels?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(rows[1]).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(design);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says which measurements hold a design surface and does not offer the delete", () => {
    const onDelete = renderList([{ ...design, measurement_count: 2 }]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Final levels?" });
    expect(dialog).toHaveTextContent("Used by 2 measurements: delete those first.");
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps the failed row's Delete as it was", () => {
    const failed: Surface = { ...design, status: "failed", error: "import cancelled" };
    const onDelete = renderList([failed]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(failed);
  });
});
