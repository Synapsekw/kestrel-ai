import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImportElevationDialog } from "./ImportElevationDialog";

vi.mock("./ImportDesignDialog", () => ({
  ImportDesignDialog: () => <div role="dialog" aria-label="Import design surface" />,
}));

describe("ImportElevationDialog", () => {
  it("opens the design-surface import", async () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <ImportElevationDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: /Design surface/ }));
    expect(await screen.findByRole("dialog", { name: "Import design surface" })).toBeInTheDocument();
  });

  it("links a cloud-built DSM to the volume view", () => {
    const onClose = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(
      <ImportElevationDialog projectId={PROJECT_ID} onClose={onClose} onStarted={() => {}} />,
      { api },
    );
    const link = screen.getByRole("link", { name: /Build from a point cloud/ });
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}/measurements/volumes`);
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });
});
