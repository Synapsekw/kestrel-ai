import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  it("creates a training project by default, with the class list", async () => {
    const { api, requests } = fakeClient([
      emptyList,
      { method: "POST", path: /\/projects$/, status: 201, body: exampleProject },
    ]);
    renderWithProviders(<ProjectsScreen />, { api });
    expect(screen.getByRole("radio", { name: "Training project" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Edit the class list")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Yard" } });
    fireEvent.change(screen.getAllByLabelText("Folder")[0], { target: { value: "E:/Projects/Yard" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const body = requests.find((r) => r.method === "POST")?.body as { kind: string; classes: unknown[] };
    expect(body.kind).toBe("train");
    expect(body.classes.length).toBeGreaterThan(0);
  });

  it("choosing Detection hides the class editor and sends kind detect with no classes", async () => {
    const { api, requests } = fakeClient([
      emptyList,
      {
        method: "POST",
        path: /\/projects$/,
        status: 201,
        body: { ...exampleProject, kind: "detect", classes: [] },
      },
    ]);
    renderWithProviders(<ProjectsScreen />, { api });
    fireEvent.click(screen.getByRole("radio", { name: "Detection project" }));
    expect(screen.queryByText("Edit the class list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan with the setup agent" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "North site" } });
    fireEvent.change(screen.getAllByLabelText("Folder")[0], { target: { value: "E:/Projects/North" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({
      name: "North site",
      kind: "detect",
      classes: [],
    });
  });

  it("shows each project's kind and filters the list by kind", async () => {
    const detection = { ...exampleProject, id: "p-detect", name: "North site", kind: "detect" as const };
    const { api } = fakeClient([
      { method: "GET", path: /\/projects$/, body: { items: [exampleProject, detection], next_cursor: null } },
    ]);
    renderWithProviders(<ProjectsScreen />, { api });
    const list = await screen.findByRole("list", { name: "Recent projects" });
    expect(within(list).getByText("Training")).toBeInTheDocument();
    expect(within(list).getByText("Detection")).toBeInTheDocument();
    const filter = screen.getByRole("radiogroup", { name: "Show projects" });
    fireEvent.click(within(filter).getByRole("radio", { name: "Detection" }));
    expect(within(list).queryByText(exampleProject.name)).toBeNull();
    expect(within(list).getByText("North site")).toBeInTheDocument();
    fireEvent.click(within(filter).getByRole("radio", { name: "Training" }));
    expect(within(list).getByText(exampleProject.name)).toBeInTheDocument();
    expect(within(list).queryByText("North site")).toBeNull();
    fireEvent.click(within(filter).getByRole("radio", { name: "All" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });
});
