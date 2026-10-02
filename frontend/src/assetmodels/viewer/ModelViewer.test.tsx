import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("./engine", async (orig) => ({
  ...(await orig<typeof import("./engine")>()),
  createModelEngine: (o: unknown) => create(o),
}));

import { NoWebGlError } from "@/clouds/viewer/engine";
import { ModelViewer } from "./ModelViewer";

const stub = (load: () => Promise<unknown>, dispose = vi.fn()) => ({
  load,
  dispose,
  setGroupVisible: vi.fn(),
  select: vi.fn(),
  setCut: vi.fn(),
  setLevels: vi.fn(),
  setHeadOff: vi.fn(),
  setOverlay: vi.fn(),
  setView: vi.fn(),
});

describe("ModelViewer", () => {
  it("no-webgl shows a notice, never a blank canvas", async () => {
    create.mockImplementation(() => {
      throw new NoWebGlError("no");
    });
    const onState = vi.fn();
    render(<ModelViewer glbUrl="x.glb" onParts={() => {}} onSelect={() => {}} onState={onState} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/3D view is off/i);
    expect(onState).toHaveBeenCalledWith("no-webgl");
  });

  it("load-error shows a notice with reload", async () => {
    create.mockImplementation(() => stub(() => Promise.reject(new Error("bad glb"))));
    const onState = vi.fn();
    render(<ModelViewer glbUrl="x.glb" onParts={() => {}} onSelect={() => {}} onState={onState} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.getByRole("button", { name: /reload view/i })).toBeInTheDocument();
    expect(onState).toHaveBeenCalledWith("load-error");
  });

  it("reports parts after a load and disposes on unmount", async () => {
    const dispose = vi.fn();
    create.mockImplementation(() =>
      stub(() => Promise.resolve([{ id: "s", name: "S", group: "Shell" }]), dispose),
    );
    const onParts = vi.fn();
    const onState = vi.fn();
    const { unmount } = render(
      <ModelViewer glbUrl="x.glb" onParts={onParts} onSelect={() => {}} onState={onState} />,
    );
    await waitFor(() => expect(onParts).toHaveBeenCalledWith([{ id: "s", name: "S", group: "Shell" }]));
    expect(onState).toHaveBeenLastCalledWith("running");
    unmount();
    expect(dispose).toHaveBeenCalled();
  });

  it("does not create an engine without a GLB url", () => {
    create.mockClear();
    render(<ModelViewer glbUrl={null} onParts={() => {}} onSelect={() => {}} />);
    expect(create).not.toHaveBeenCalled();
  });
});
