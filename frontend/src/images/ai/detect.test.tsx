import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import type { LibraryModel } from "@contract/client";
import {
  errorBody,
  exampleClasses,
  exampleModel,
  exampleProject,
  fakeClient,
  MODEL_ID,
  type FakeRoute,
} from "@/test/fixtures";
import { useToastStore } from "@/ui";
import { ensureBuiltInTools } from "@/images/tools"; // I-FC
import { AiBar } from "./AiBar";
import { AiDetectButton } from "./AiDetectButton";
import { useAiStore } from "./aiStore";
import { useCanvasKeyHandlers, useCommandContext, useImagesKeymap, wsGet } from "./bridge";
import { ModelMenu } from "./ModelMenu";
import { stem } from "./models";
import { ensureAiRegistered } from "./register";
import { detectToastText } from "./useDetect";
import { useAiWorkspace } from "./useAiWorkspace";
import { renderAi, resetAll, seedWorkspace, suggestion } from "./testing";

const model: LibraryModel = {
  ...exampleModel,
  task: "segment",
  class_names: [exampleClasses[0].name],
  class_aliases: {},
  class_map: {},
};
const unmapped: LibraryModel = {
  ...exampleModel,
  id: "m-x",
  name: "coco",
  class_names: ["zebra"],
  class_aliases: {},
  class_map: {},
};
const routes = (detect: Partial<FakeRoute> = {}): FakeRoute[] => [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/library\/models$/, body: { items: [model, unmapped], next_cursor: null } },
  {
    method: "POST",
    path: /\/images\/[^/]+\/detect$/,
    body: {
      model_id: MODEL_ID,
      suggestions: [suggestion("n1", 0.7)],
      new: 1,
      already_covered: 5,
      device: "cpu",
      elapsed_ms: 900,
    },
    ...detect,
  },
];
function Menu() {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref}>AI</button>
      <ModelMenu projectId="p" anchorRef={ref} />
      <AiBar />
    </>
  );
}
/** Wires FA's real key layer (Task 5 review): the window Tab row must not block focus inside the menu. */
function KeymapHarness() {
  const ctx = useCommandContext("p");
  const ai = useAiWorkspace({ projectId: "p", index: null, onOpenImage: vi.fn() });
  useImagesKeymap([ai.keyHandlers, useCanvasKeyHandlers(ctx)]);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref}>AI</button>
      <ModelMenu projectId="p" anchorRef={ref} />
    </>
  );
}
const texts = () => useToastStore.getState().toasts.map((t) => t.text);

beforeEach(() => {
  resetAll();
  seedWorkspace([suggestion("old", 0.4)]);
  act(() => useAiStore.getState().openMenu());
});

describe("model menu and detect", () => {
  it("lists only models that reach a project type, with task · types and mAP", async () => {
    const { api } = fakeClient(routes());
    renderAi(<Menu />, api);
    expect(await screen.findByText(model.name)).toBeTruthy();
    expect(screen.queryByText("coco")).toBeNull();
    expect(screen.getByText(`Segmentation · ${exampleClasses[0].name}`)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: new RegExp(`Detect on ${stem(wsGet().image!.file_name)}`) }),
    ).toBeTruthy();
  });

  it("runs, replaces the model's old suggestions, toasts new / already covered and CPU", async () => {
    const { api, requests } = fakeClient(routes());
    renderAi(<Menu />, api);
    fireEvent.click(await screen.findByRole("button", { name: /Detect on/ }));
    expect(useAiStore.getState().detect?.modelName).toBe(model.name);
    expect(screen.getByText(`${model.name} · detecting…`)).toBeTruthy();
    await act(async () => {});
    expect(requests.find((r) => r.url.endsWith("/detect"))?.body).toEqual({ model_id: MODEL_ID, conf: 0.25 });
    expect(Object.keys(wsGet().boxes).sort()).toEqual(["n1"]);
    expect(texts()).toContain(`${model.name}: 1 new, 5 already covered · ran on CPU`);
    expect(useAiStore.getState().detect).toBeNull();
    expect(useAiStore.getState().menuOpen).toBe(false);
  });

  it("D pressed again (runNonce) runs the model from the menu", async () => {
    const { api, requests } = fakeClient(routes());
    renderAi(<Menu />, api);
    await screen.findByText(model.name);
    act(() => useAiStore.getState().requestRun());
    await act(async () => {});
    expect(requests.some((r) => r.url.endsWith("/detect"))).toBe(true);
  });

  it("does not add results to another image the operator moved to", async () => {
    const { api } = fakeClient(routes());
    renderAi(<Menu />, api);
    fireEvent.click(await screen.findByRole("button", { name: /Detect on/ }));
    act(() => seedWorkspace([], { ...wsGet().image!, id: "other" }));
    await act(async () => {});
    expect(wsGet().boxes).toEqual({});
    expect(texts().some((t) => t.includes("1 new"))).toBe(true);
  });

  it("Esc (discardDetect) drops the result", async () => {
    const { api } = fakeClient(routes());
    renderAi(<Menu />, api);
    fireEvent.click(await screen.findByRole("button", { name: /Detect on/ }));
    act(() => void useAiStore.getState().discardDetect());
    await act(async () => {});
    expect(Object.keys(wsGet().boxes)).toEqual(["old"]);
  });

  it("explains unmapped classes with a link to the class map", async () => {
    const { api } = fakeClient(routes({ status: 422, body: errorBody("unmapped_classes", "none mapped") }));
    renderAi(<Menu />, api);
    fireEvent.click(await screen.findByRole("button", { name: /Detect on/ }));
    await act(async () => {});
    const t = useToastStore.getState().toasts.at(-1)!;
    expect(t.text).toBe("None of this model's classes map to this project's types.");
    expect(t.action?.label).toBe("Open class map");
  });

  it("refuses a second run while one is out, so the first result is never dropped (M6)", async () => {
    const { api, requests } = fakeClient(routes());
    renderAi(<Menu />, api);
    fireEvent.click(await screen.findByRole("button", { name: /Detect on/ }));
    expect(useAiStore.getState().detect).not.toBeNull();
    act(() => useAiStore.getState().openMenu());
    expect((screen.getByRole("button", { name: /Detect on/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => useAiStore.getState().requestRun()); // D inside the menu
    await act(async () => {});
    expect(requests.filter((r) => r.url.endsWith("/detect"))).toHaveLength(1);
    expect(Object.keys(wsGet().boxes).sort()).toEqual(["n1"]);
    expect(texts()).toContain(`${model.name}: 1 new, 5 already covered · ran on CPU`);
  });

  it("re-seeds the chosen model from the new project's last choice (M7)", async () => {
    const other = { ...model, id: "m-2", name: "second" };
    localStorage.setItem("kestrel.images.detectModel.p2", "m-2");
    const { api } = fakeClient([
      routes()[0],
      { method: "GET", path: /\/library\/models$/, body: { items: [model, other], next_cursor: null } },
    ]);
    function Switcher() {
      const ref = useRef<HTMLButtonElement>(null);
      const [projectId, setProjectId] = useState("p");
      return (
        <>
          <button ref={ref} data-testid="project-2" onClick={() => setProjectId("p2")} />
          <ModelMenu projectId={projectId} anchorRef={ref} />
        </>
      );
    }
    renderAi(<Switcher />, api);
    const selected = () => screen.getByRole("option", { selected: true }).textContent;
    await vi.waitFor(() => expect(selected()).toContain(model.name));
    fireEvent.click(screen.getByTestId("project-2"));
    await vi.waitFor(() => expect(selected()).toContain("second"));
  });

  it("formats the toast", () => {
    expect(detectToastText("Crack-seg v4", { new: 2, already_covered: 5, device: "cuda" })).toBe(
      "Crack-seg v4: 2 new, 5 already covered",
    );
  });

  it("re-reads the project when a suggestion has a type the project did not list (I-BP R-BP1)", async () => {
    // drift.md Task 8: a bare `useProject(...).reload()` re-fetches an object nothing reads; the real
    // fix pushes the refreshed classes into FC's store, so assert `wsGet().types` gained the type
    // rather than only counting GETs.
    // A menu mount issues several duplicate `GET /projects/{id}` (ModelMenu, useDetectModels,
    // useDetect: drift.md Task 8), so counting calls is unreliable. Flip the project's answer only
    // once the detect POST itself has been served: the sole GET after that point is the re-read
    // `useDetect` triggers, and it must be the one whose classes land in `wsGet().types`.
    const newType = { ...exampleClasses[0], id: "new-type", name: "New Type", order: 99 };
    let detected = false;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/projects\/[^/]+$/,
        body: () =>
          detected ? { ...exampleProject, classes: [...exampleClasses, newType] } : exampleProject,
      },
      { method: "GET", path: /\/library\/models$/, body: { items: [model, unmapped], next_cursor: null } },
      {
        method: "POST",
        path: /\/images\/[^/]+\/detect$/,
        body: () => {
          detected = true;
          return {
            model_id: MODEL_ID,
            suggestions: [suggestion("n1", 0.7, { class_id: "new-type" })],
            new: 1,
            already_covered: 0,
            device: "cuda",
            elapsed_ms: 10,
          };
        },
      },
    ]);
    renderAi(<Menu />, api);
    fireEvent.click(await screen.findByRole("button", { name: /Detect on/ }));
    await act(async () => {});
    await act(async () => {});
    expect(wsGet().types.some((t) => t.id === "new-type")).toBe(true);
  });

  it("the palette's AI button opens the menu", async () => {
    act(() => useAiStore.getState().closeMenu());
    const { api } = fakeClient(routes());
    renderAi(<AiDetectButton projectId="p" />, api);
    fireEvent.click(screen.getByRole("button", { name: /AI detect/ }));
    expect(useAiStore.getState().menuOpen).toBe(true);
    expect(await screen.findByText(model.name)).toBeTruthy();
  });

  it("Tab inside the open menu is not defaultPrevented (Task 5 review: FA's window Tab row)", async () => {
    ensureBuiltInTools();
    ensureAiRegistered();
    const { api } = fakeClient(routes());
    renderAi(<KeymapHarness />, api);
    const runButton = await screen.findByRole("button", { name: /Detect on/ });
    const focusSuggestion = vi.spyOn(wsGet(), "focusSuggestion");
    let allowed = false;
    act(() => {
      allowed = fireEvent.keyDown(runButton, { key: "Tab" });
    });
    expect(allowed).toBe(true);
    expect(focusSuggestion).not.toHaveBeenCalled();
  });
});
