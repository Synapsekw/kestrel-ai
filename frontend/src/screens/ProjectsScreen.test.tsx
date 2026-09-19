import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { errorBody, exampleProject, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ProjectsScreen } from "./ProjectsScreen";

const emptyList = { method: "GET" as const, path: /\/projects$/, body: { items: [], next_cursor: null } };

describe("ProjectsScreen", () => {
  it("asks for a folder instead of sending a request the backend will reject", async () => {
    const { api, requests } = fakeClient([emptyList]);
    renderWithProviders(<ProjectsScreen />, { api });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Site A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Choose a folder for the project."),
    );
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("shows which field the backend rejected", async () => {
    const { api } = fakeClient([
      emptyList,
      {
        method: "POST",
        path: /\/projects$/,
        status: 422,
        body: errorBody("validation_error", "request validation failed", {
          errors: [{ loc: ["body", "classes"], msg: "List should have at least 1 item", type: "too_short" }],
        }),
      },
    ]);
    renderWithProviders(<ProjectsScreen />, { api });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Site A" } });
    fireEvent.change(screen.getAllByLabelText("Folder")[0], { target: { value: "E:\\Projects\\A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("classes: List should have at least 1 item"),
    );
  });

  it("removes a project from the recent list after asking, and says the folder stays", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/projects$/, body: { items: [exampleProject], next_cursor: null } },
      { method: "DELETE", path: /\/projects\/[^/]+$/, status: 204 },
    ]);
    renderWithProviders(<ProjectsScreen />, { api });
    fireEvent.click(
      await screen.findByRole("button", { name: `Remove ${exampleProject.name} from the list` }),
    );
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(screen.getByText(/The folder and everything in it stay on disk/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove from the list" }));
    await waitFor(() => expect(screen.queryByText(exampleProject.name)).toBeNull());
    expect(requests.at(-1)).toMatchObject({ method: "DELETE", url: `/api/v1/projects/${exampleProject.id}` });
  });
});
