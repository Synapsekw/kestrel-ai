import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { SiteAreaDrawBar } from "./SiteAreaDrawBar";
import { MAP_ID, PROJECT_ID, siteAreas } from "./fixtures";

const polygon = [
  [10, 20],
  [110, 20],
  [110, 220],
];

describe("SiteAreaDrawBar", () => {
  it("explains how to outline an area until one is drawn", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <SiteAreaDrawBar
        projectId={PROJECT_ID}
        mapId={MAP_ID}
        polygon={null}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
      { api },
    );
    expect(screen.getByText(/double-click to finish/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save site area" })).not.toBeInTheDocument();
  });

  it("names the drawn outline and sends it in map pixels", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /site-areas$/, status: 201, body: siteAreas[0] },
    ]);
    const onSaved = vi.fn();
    renderWithProviders(
      <SiteAreaDrawBar
        projectId={PROJECT_ID}
        mapId={MAP_ID}
        polygon={polygon}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />,
      { api },
    );
    const save = screen.getByRole("button", { name: "Save site area" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Site area name"), { target: { value: "North yard" } });
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(siteAreas[0]));
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      name: "North yard",
      map_id: MAP_ID,
      polygon_px: polygon,
    });
  });

  it("keeps the outline and shows the error when saving fails", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /site-areas$/,
        status: 422,
        body: { error: { code: "validation_error", message: "this map has no georeference", details: {} } },
      },
    ]);
    const onSaved = vi.fn();
    renderWithProviders(
      <SiteAreaDrawBar
        projectId={PROJECT_ID}
        mapId={MAP_ID}
        polygon={polygon}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Site area name"), { target: { value: "Yard" } });
    fireEvent.click(screen.getByRole("button", { name: "Save site area" }));
    expect(await screen.findByText(/no georeference/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
