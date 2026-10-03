import { createRef } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("./engine", async (orig) => ({
  ...(await orig<typeof import("./engine")>()),
  createModelEngine: (o: unknown) => create(o),
}));

import { NoWebGlError } from "@/clouds/viewer/engine";
import { ModelViewer, type ModelViewerHandle } from "./ModelViewer";

const stub = (load: () => Promise<unknown>, dispose = vi.fn()) => ({
  load: vi.fn(load),
  dispose,
  setGroupVisible: vi.fn(),
  select: vi.fn(),
  setCut: vi.fn(),
  setLevels: vi.fn(),
  setHeadOff: vi.fn(),
  setOverlay: vi.fn(),
  setView: vi.fn(),
  setPlacements: vi.fn(),
  setCameras: vi.fn(),
  setSelectedCamera: vi.fn(),
  focusFinding: vi.fn(() => true),
  setGhost: vi.fn(),
  setAutoRotate: vi.fn(),
  setGround: vi.fn(),
  viewFromPose: vi.fn(),
  onPick: vi.fn(),
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

  it("a failed swap labels the old model stale and offers a reload", async () => {
    create.mockReset();
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([{ id: "s", name: "S", group: "Shell" }])
      .mockRejectedValueOnce(new Error("bad v3"));
    create.mockImplementation(() => stub(load));
    const onParts = vi.fn();
    const onState = vi.fn();
    const { rerender } = render(
      <ModelViewer glbUrl="v2.glb" onParts={onParts} onSelect={() => {}} onState={onState} />,
    );
    await waitFor(() => expect(onParts).toHaveBeenCalledTimes(1));
    rerender(<ModelViewer glbUrl="v3.glb" onParts={onParts} onSelect={() => {}} onState={onState} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/the new version's 3D model could not load/i);
    expect(alert).toHaveTextContent(/stale/i);
    expect(alert).toHaveTextContent(/the model shown is the previous version/i);
    expect(screen.getByRole("button", { name: /reload view/i })).toBeInTheDocument();
    expect(onState).toHaveBeenLastCalledWith("load-error");
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

  it("a new GLB of the same model loads into the same engine, keeps the camera and the selection", async () => {
    create.mockReset();
    const load = vi.fn(() => Promise.resolve([{ id: "N7", name: "N7", group: "Nozzle" }]));
    const eng = stub(load);
    create.mockImplementation(() => eng);
    const onSelect = vi.fn();
    const onParts = vi.fn();
    const ref = createRef<ModelViewerHandle>();
    const { rerender } = render(
      <ModelViewer ref={ref} glbUrl="v2.glb" onParts={onParts} onSelect={onSelect} />,
    );
    await waitFor(() => expect(onParts).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenLastCalledWith("v2.glb", { keepCamera: false });
    act(() => ref.current!.select("N7"));
    rerender(<ModelViewer ref={ref} glbUrl="v3.glb" onParts={onParts} onSelect={onSelect} />);
    await waitFor(() => expect(onParts).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledTimes(1);
    expect(eng.dispose).not.toHaveBeenCalled();
    expect(load).toHaveBeenLastCalledWith("v3.glb", { keepCamera: true });
    expect(eng.setView).not.toHaveBeenCalled();
    expect(eng.select).toHaveBeenLastCalledWith("N7");
  });

  it("a programmatic select never echoes back through onSelect", async () => {
    create.mockReset();
    let emit: (id: string | null) => void = () => {};
    const eng = stub(() => Promise.resolve([]));
    // The engine echoes onSelect, with null for an id it does not hold.
    eng.select.mockImplementation(() => emit(null));
    create.mockImplementation((o: { onSelect(id: string | null): void }) => {
      emit = o.onSelect;
      return eng;
    });
    const onSelect = vi.fn();
    const onState = vi.fn();
    const ref = createRef<ModelViewerHandle>();
    render(
      <ModelViewer ref={ref} glbUrl="v2.glb" onParts={() => {}} onSelect={onSelect} onState={onState} />,
    );
    await waitFor(() => expect(onState).toHaveBeenLastCalledWith("running"));
    act(() => ref.current!.select("gone"));
    expect(eng.select).toHaveBeenCalledWith("gone");
    expect(onSelect).not.toHaveBeenCalled();
    // a click in the view still reports
    act(() => emit("N7"));
    expect(onSelect).toHaveBeenCalledWith("N7");
  });

  it("reload view builds a fresh engine and frames it", async () => {
    create.mockReset();
    const bad = stub(() => Promise.reject(new Error("bad")));
    const good = stub(() => Promise.resolve([]));
    create.mockImplementationOnce(() => bad).mockImplementationOnce(() => good);
    render(<ModelViewer glbUrl="v2.glb" onParts={() => {}} onSelect={() => {}} />);
    (await screen.findByRole("button", { name: /reload view/i })).click();
    await waitFor(() => expect(good.load).toHaveBeenCalledWith("v2.glb", { keepCamera: false }));
    expect(bad.dispose).toHaveBeenCalled();
  });
  it("replays placements, cameras, ghost, rotate, ground and the pose onto the engine after a load", async () => {
    let resolve: (v: unknown) => void = () => {};
    const eng = stub(() => new Promise((r) => (resolve = r)));
    create.mockImplementation(() => eng);
    const ref = createRef<ModelViewerHandle>();
    render(<ModelViewer ref={ref} glbUrl="x.glb" onParts={() => {}} onSelect={() => {}} />);
    const fetchPatch = vi.fn();
    const pose = {
      imageId: "i1",
      position: [1, 2, 3],
      target: [0, 0, 0],
      up: [0, 1, 0],
      hfovDeg: 70,
      vfovDeg: 50,
      sequence: null,
      outcome: null,
    } as const;
    act(() => {
      ref.current!.setPlacements([], fetchPatch);
      ref.current!.setCameras([pose as never], () => "#ffffff");
      ref.current!.setSelectedCamera("i1", true);
      ref.current!.setGhost(true);
      ref.current!.setAutoRotate(true, 1.2);
      ref.current!.setGround([]);
      ref.current!.viewFromPose(pose as never);
    });
    eng.setGhost.mockClear();
    await act(async () => resolve([]));
    await waitFor(() => expect(eng.setGhost).toHaveBeenCalledWith(true));
    expect(eng.setPlacements).toHaveBeenLastCalledWith([], fetchPatch);
    expect(eng.setCameras).toHaveBeenCalled();
    expect(eng.setSelectedCamera).toHaveBeenLastCalledWith("i1", true);
    expect(eng.setAutoRotate).toHaveBeenLastCalledWith(true, 1.2);
    expect(eng.setGround).toHaveBeenLastCalledWith([]);
    expect(eng.viewFromPose).toHaveBeenLastCalledWith(pose);
  });

  it("passes the engine's picks out and forwards focusFinding", async () => {
    const eng = stub(() => Promise.resolve([]));
    create.mockImplementation(() => eng);
    const onPick = vi.fn();
    const ref = createRef<ModelViewerHandle>();
    render(<ModelViewer ref={ref} glbUrl="x.glb" onParts={() => {}} onSelect={() => {}} onPick={onPick} />);
    await waitFor(() => expect(eng.onPick).toHaveBeenCalled());
    const cb = eng.onPick.mock.calls[0][0] as (h: unknown) => void;
    cb({ kind: "finding", id: "f1" });
    expect(onPick).toHaveBeenCalledWith({ kind: "finding", id: "f1" });
    expect(ref.current!.focusFinding("f1")).toBe(true);
    expect(eng.focusFinding).toHaveBeenCalledWith("f1", undefined);
  });
});
