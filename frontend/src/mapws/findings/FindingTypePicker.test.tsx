import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { baseRoutes, projectTypes, typedProject, TYPE_CRACK } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { FindingTypePicker } from "./FindingTypePicker";

describe("FindingTypePicker", () => {
  it("offers the project's defect types only", async () => {
    const onPick = vi.fn();
    const { api } = fakeClient(baseRoutes());
    renderWithProviders(<FindingTypePicker projectId={PROJECT_ID} onPick={onPick} />, { api });
    const crack = await screen.findByRole("option", { name: /Crack/ });
    expect(screen.getByRole("option", { name: /Spalling/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /excavator/i })).toBeNull();
    fireEvent.click(crack);
    expect(onPick).toHaveBeenCalledWith(TYPE_CRACK);
  });

  it("type hotkeys are live inside the picker", async () => {
    const onPick = vi.fn();
    const withKey = {
      ...typedProject,
      classes: projectTypes.map((t) => (t.id === TYPE_CRACK ? { ...t, hotkey: "2" } : t)),
    };
    const { api } = fakeClient(baseRoutes([{ method: "GET", path: /\/projects\/[^/]+$/, body: withKey }]));
    renderWithProviders(<FindingTypePicker projectId={PROJECT_ID} onPick={onPick} />, { api });
    fireEvent.keyDown(await screen.findByRole("combobox", { name: "Finding type" }), { key: "2" });
    expect(onPick).toHaveBeenCalledWith(TYPE_CRACK);
  });

  it("explains an empty catalogue", async () => {
    const none = {
      ...typedProject,
      classes: projectTypes.filter((t) => t.kind === "object"),
    };
    const { api } = fakeClient(baseRoutes([{ method: "GET", path: /\/projects\/[^/]+$/, body: none }]));
    renderWithProviders(<FindingTypePicker projectId={PROJECT_ID} onPick={vi.fn()} />, { api });
    expect(await screen.findByText(/no defect types yet/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New anomaly name" })).toBeInTheDocument();
  });

  it("names a defect and uses it for the mark just drawn", async () => {
    const onPick = vi.fn();
    const typeId = "c1a2b3c4-0000-4000-8000-000000000099";
    const none = { ...typedProject, classes: projectTypes.filter((t) => t.kind === "object") };
    const saved = {
      ...exampleProject,
      classes: [...none.classes, { ...projectTypes[0], id: typeId, name: "Rust", kind: "defect" as const }],
    };
    const { api, requests } = fakeClient(
      baseRoutes([
        { method: "GET", path: /\/projects\/[^/]+$/, body: none },
        { method: "POST", path: /\/catalogue\/types$/, body: { id: typeId } },
        { method: "PUT", path: /\/projects\/[^/]+\/types$/, body: saved },
      ]),
    );
    renderWithProviders(<FindingTypePicker projectId={PROJECT_ID} onPick={onPick} />, { api });
    await userEvent.type(await screen.findByRole("textbox", { name: "New anomaly name" }), "Rust");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(typeId));
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ name: "Rust", kind: "defect" });
  });
});
