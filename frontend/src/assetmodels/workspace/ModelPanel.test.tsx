import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MODEL } from "@/test/assetModelFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { ModelPanel } from "./ModelPanel";

const other = {
  ...MODEL,
  id: "m2",
  name: "Stack",
  tag: null,
  current_version: null,
  status: "empty" as const,
};

function show(onDeleted = vi.fn(), routes: Parameters<typeof fakeClient>[0] = []) {
  const client = fakeClient(routes);
  renderWithProviders(
    <>
      <ModelPanel
        projectId={PROJECT_ID}
        model={MODEL}
        models={[MODEL, other]}
        onNew={vi.fn()}
        onDetails={vi.fn()}
        onDeleted={onDeleted}
        groups={[]}
        hiddenGroups={new Set()}
        onGroup={vi.fn()}
        overlay={null}
        overlayAvailable={false}
        onOverlay={vi.fn()}
        view={{ ghost: false, rotate: false, ground: false }}
        onViewSwitch={vi.fn()}
        groundAvailable={false}
        onImportGlb={vi.fn()}
        onImportReview={vi.fn()}
      />
      <LocationProbe />
    </>,
    { api: client.api, route: `/p/${PROJECT_ID}/models/m1` },
  );
  return client;
}

describe("ModelPanel delete", () => {
  it("asks before deleting a listed model, and the trash does not open it", async () => {
    const onDeleted = vi.fn();
    const { requests } = show(onDeleted, [{ method: "DELETE", path: /\/asset-models\/m2$/, status: 204 }]);
    await userEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Stack" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1`);
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
    expect(dialog).toHaveTextContent("Every version and its 3D model go with it. This can't be undone.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onDeleted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Stack" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: "m2" })));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1`);
  });

  it("keeps the dialog open when the delete fails", async () => {
    const onDeleted = vi.fn();
    show(onDeleted, [
      {
        method: "DELETE",
        path: /\/asset-models\/m2$/,
        status: 409,
        body: { error: { code: "conflict", message: "A run is still going.", details: {} } },
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Stack" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("A run is still going.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Are you sure?" })).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("says why when findings still sit on the model", async () => {
    const onDeleted = vi.fn();
    show(onDeleted, [
      {
        method: "DELETE",
        path: /\/asset-models\/m2$/,
        status: 409,
        body: {
          error: {
            code: "has_findings",
            message: "3 findings are placed on this model. Delete them or move them to another model first.",
            details: { count: 3 },
          },
        },
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Stack" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText(/3 findings are placed on this model/)).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
