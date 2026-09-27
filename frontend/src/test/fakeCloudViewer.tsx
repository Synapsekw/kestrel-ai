/* eslint-disable react-refresh/only-export-components -- a test double and its controls */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { CloudPick, CloudViewerHandle, CloudViewerProps, ViewState } from "@/clouds/CloudViewer";
import type { ColourAvailability, FrameCamera } from "@/clouds/viewer/types";

export const FAKE_PICK: CloudPick = { x: 243500.5, y: 3178000.25, z: 12.5, level: 3, uncertainty_m: 0.04 };

interface FakeState {
  calls: { name: string; args: unknown[] }[];
  frames: Set<(cam: FrameCamera) => void>;
  state: ViewState;
  availability: ColourAvailability | null;
  /** The handle has V2's setClipBox (Fly and Clip enabled). */
  v2: boolean;
}

export const fake: FakeState = {
  calls: [],
  frames: new Set(),
  state: "running",
  availability: { rgb: true, elevation: true, intensity: false, classification: true },
  v2: true,
};

export function resetFake(over: Partial<Omit<FakeState, "calls" | "frames">> = {}): void {
  fake.calls = [];
  fake.frames = new Set();
  fake.state = "running";
  fake.availability = { rgb: true, elevation: true, intensity: false, classification: true };
  fake.v2 = true;
  Object.assign(fake, over);
}

export function callsTo(name: string): unknown[][] {
  return fake.calls.filter((c) => c.name === name).map((c) => c.args);
}

export function emitFrame(cam: Partial<FrameCamera> = {}): void {
  const full: FrameCamera = {
    viewProj: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
    rect: new DOMRect(0, 0, 800, 600),
    position: [243550, 3178000, 80],
    direction: [0, 1, 0],
    ...cam,
  };
  for (const cb of [...fake.frames]) cb(full);
}

export const FakeCloudViewer = forwardRef<CloudViewerHandle, CloudViewerProps>(
  function FakeCloudViewer(props, ref) {
    const latest = useRef(props);
    useEffect(() => {
      latest.current = props;
    });
    useImperativeHandle(ref, () => {
      const rec =
        (name: string) =>
        (...args: unknown[]) => {
          fake.calls.push({ name, args });
        };
      const handle = {
        fit: rec("fit"),
        topView: rec("topView"),
        lookAt: rec("lookAt"),
        pickAtClient: () => null,
        pickDown: () => null,
        project: () => null,
        canvasRect: () => null,
        setOverlay: rec("setOverlay"),
        stats: () => ({
          numVisiblePoints: 2_400_000,
          visibleNodes: 10,
          nodesLoading: 0,
          firstPointsMs: 100,
          settledMs: 900,
          errors: [],
          contextLost: false,
          cameraDistance: 120,
        }),
        setNavMode: rec("setNavMode"),
        navMode: () => "orbit",
        setView: rec("setView"),
        goToPose: rec("goToPose"),
        currentPose: () => ({
          position: [243600, 3178000, 150],
          target: [243550, 3178050, 0],
          up: [0, 0, 1],
          fov_deg: 60,
        }),
        setColourMode: rec("setColourMode"),
        setClassVisibility: rec("setClassVisibility"),
        colourAvailability: () => fake.availability,
        onFrame: (cb: (cam: FrameCamera) => void) => {
          fake.frames.add(cb);
          return () => fake.frames.delete(cb);
        },
        topSnapshot: (...args: unknown[]) => {
          fake.calls.push({ name: "topSnapshot", args });
          return Promise.resolve(null);
        },
        frameTimes: () => [],
        edl: () => ({ on: true, rendersToTarget: false }),
        setEdl: rec("setEdl"),
        requestRender: rec("requestRender"),
        ...(fake.v2 ? { setClipBox: rec("setClipBox") } : {}),
      };
      return handle as unknown as CloudViewerHandle;
    }, []);
    useEffect(() => {
      const p = latest.current;
      p.onViewState?.(fake.state);
      if (fake.state === "running" && fake.availability) p.onAttributes?.(fake.availability);
      p.onPointsShown?.({ pts: 2_400_000, loading: 0 });
    }, []);
    return (
      <div
        data-testid="cloud-viewer"
        data-armed={String(!!props.armed)}
        data-colour={props.colour}
        data-budget={props.budget}
      >
        <button type="button" onClick={() => latest.current.onPick?.(FAKE_PICK)}>
          fake pick
        </button>
        <button type="button" onClick={() => latest.current.onHover?.(FAKE_PICK)}>
          fake hover
        </button>
      </div>
    );
  },
);
