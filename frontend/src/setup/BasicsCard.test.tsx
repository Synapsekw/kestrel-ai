import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { BasicsCard } from "./BasicsCard";
import { useSetupDraft } from "./draftStore";

describe("BasicsCard", () => {
  beforeEach(() => useSetupDraft.getState().discard());

  it("writes the name and folder to the draft, which keeps them after the card unmounts", () => {
    const { api } = fakeClient([]);
    const view = renderWithProviders(<BasicsCard />, { api });
    expect(screen.getByRole("region", { name: "Basics" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mast SR-0412" } });
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "E:\\Projects\\SR-0412" } });
    expect(useSetupDraft.getState()).toMatchObject({ name: "Mast SR-0412", folder: "E:\\Projects\\SR-0412" });
    view.unmount();
    renderWithProviders(<BasicsCard />, { api });
    expect(screen.getByLabelText("Name")).toHaveValue("Mast SR-0412");
    expect(screen.getByLabelText("Folder")).toHaveValue("E:\\Projects\\SR-0412");
  });

  it("offers the folder picker only in the desktop shell", () => {
    const { api } = fakeClient([]);
    const view = renderWithProviders(<BasicsCard />, { api });
    expect(screen.queryByRole("button", { name: "Browse" })).toBeNull();
    view.unmount();
    renderWithProviders(<BasicsCard />, { api, mode: "tauri" });
    expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
  });
});
