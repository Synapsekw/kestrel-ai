import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { StarterModel } from "@contract/client";
import { errorBody, exampleModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { StarterModels } from "./StarterModels";

const starters: StarterModel[] = [
  {
    key: "yolo11n",
    name: "YOLO11 nano",
    description: "Fastest to train and run.",
    size_mb: 5.4,
    available: true,
  },
  {
    key: "yolo11s",
    name: "YOLO11 small",
    description: "A little slower, usually more accurate.",
    size_mb: 18.4,
    available: true,
  },
  {
    key: "yolo11m",
    name: "YOLO11 medium",
    description: "Slowest of the three; best accuracy.",
    size_mb: 0,
    available: false,
  },
];

describe("StarterModels", () => {
  it("lists the three sizes, adds one with a click and reports it", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
      {
        method: "POST",
        path: /\/models\/import-starter$/,
        status: 201,
        body: { ...exampleModel, name: "yolo11n-coco" },
      },
    ]);
    const onImported = vi.fn();
    renderWithProviders(<StarterModels projectId={PROJECT_ID} existingNames={[]} onImported={onImported} />, {
      api,
    });
    expect(await screen.findByText("YOLO11 nano")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add YOLO11 medium" })).toBeDisabled(); // available: false
    expect(screen.getByText("Not included in this copy of the app.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add YOLO11 nano" }));
    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ name: "yolo11n-coco" })),
    );
    expect(requests.at(-1)).toMatchObject({ method: "POST", body: { key: "yolo11n" } });
  });

  it("disables every Add button while an import is in flight and sends no second request", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
      {
        method: "POST",
        path: /\/models\/import-starter$/,
        status: 201,
        body: { ...exampleModel, name: "yolo11n-coco" },
      },
    ]);
    const onImported = vi.fn();
    renderWithProviders(<StarterModels projectId={PROJECT_ID} existingNames={[]} onImported={onImported} />, {
      api,
    });
    await screen.findByText("YOLO11 nano");
    fireEvent.click(screen.getByRole("button", { name: "Add YOLO11 nano" }));
    // Synchronously, before the import resolves: the clicked button reads "Adding…" and every
    // other button (including another available size) is disabled.
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    const small = screen.getByRole("button", { name: "Add YOLO11 small" });
    expect(small).toBeDisabled();
    fireEvent.click(small);
    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ name: "yolo11n-coco" })),
    );
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("marks a size that is already in the registry and shows the envelope message on failure", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
      {
        method: "POST",
        path: /\/models\/import-starter$/,
        status: 404,
        body: errorBody("not_found", "starter weights yolo11s are not part of this build"),
      },
    ]);
    renderWithProviders(
      <StarterModels projectId={PROJECT_ID} existingNames={["yolo11n-coco"]} onImported={() => {}} />,
      { api },
    );
    const nano = await screen.findByTestId("starter-yolo11n");
    expect(within(nano).getByText("In the registry")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add YOLO11 small" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not part of this build"));
  });
});
