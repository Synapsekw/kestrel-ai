import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { CLASS_ID, errorBody, exampleClasses, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useProject } from "@/api/project";
import { addProjectType } from "./addProjectType";

const NEW_ID = "c1a2b3c4-0000-4000-8000-000000000099";

describe("addProjectType", () => {
  it("creates a defect, appends it to the project, and publishes that project", async () => {
    const created = { ...exampleClasses[0], id: NEW_ID, name: "Spall", kind: "defect" as const };
    const saved = { ...exampleProject, classes: [...exampleProject.classes, created] };
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/catalogue\/types$/, body: { id: NEW_ID } },
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "PUT", path: /\/projects\/[^/]+\/types$/, body: saved },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useProject(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.project?.name).toBe("Ahmadia"));

    const added = await addProjectType(api, PROJECT_ID, "  Spall  ", "defect");

    expect(added.typeId).toBe(NEW_ID);
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ name: "Spall", kind: "defect" });
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({
      type_ids: [...exampleProject.classes.map((c) => c.id), NEW_ID],
    });
    await waitFor(() => expect(result.current.project?.classes.some((c) => c.id === NEW_ID)).toBe(true));
  });

  it("reuses a catalogue type of the same kind and unarchives it", async () => {
    const saved = {
      ...exampleProject,
      classes: [
        ...exampleProject.classes,
        { ...exampleClasses[0], id: NEW_ID, name: "Spall", kind: "defect" as const },
      ],
    };
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/catalogue\/types$/,
        status: 409,
        body: errorBody("type_exists", "exists", { type_id: NEW_ID }),
      },
      {
        method: "GET",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { id: NEW_ID, kind: "defect", archived: true },
      },
      {
        method: "PATCH",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { id: NEW_ID, kind: "defect", archived: false },
      },
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "PUT", path: /\/projects\/[^/]+\/types$/, body: saved },
    ]);

    const added = await addProjectType(api, PROJECT_ID, "Spall");

    expect(added.typeId).toBe(NEW_ID);
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ archived: false });
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({
      type_ids: [...exampleProject.classes.map((c) => c.id), NEW_ID],
    });
  });

  it("refuses a name that already belongs to an object", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/catalogue\/types$/,
        status: 409,
        body: errorBody("type_exists", "exists", { type_id: CLASS_ID(1) }),
      },
      {
        method: "GET",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { id: CLASS_ID(1), kind: "object", archived: false },
      },
    ]);

    await expect(addProjectType(api, PROJECT_ID, "excavator")).rejects.toThrow(/already an object/);
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });
});
