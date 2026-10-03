/* eslint-disable react-refresh/only-export-components -- a test double and its controls */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ModelPart } from "@/assetmodels/viewer/engine";
import type { ModelViewerHandle, ModelViewerProps, ModelViewState } from "@/assetmodels/viewer/ModelViewer";

interface FakeState {
  calls: { name: string; args: unknown[] }[];
  /** The mounted viewer's latest props, for the emit helpers. */
  props: ModelViewerProps | null;
}

export const fake: FakeState = { calls: [], props: null };

export function resetFake(): void {
  fake.calls = [];
  fake.props = null;
}

/** The argument lists recorded for a handle method, e.g. `callsTo("setGroupVisible")` -> `[["Nozzle", false]]`. */
export function callsTo(name: string): unknown[][] {
  return fake.calls.filter((c) => c.name === name).map((c) => c.args);
}

/** The viewer reports the model's parts; wrap it in act(). */
export function emitParts(parts: ModelPart[]): void {
  fake.props?.onParts(parts);
}

/** The user clicks a part in the 3D view; wrap it in act(). */
export function emitSelect(id: string | null): void {
  fake.props?.onSelect(id);
}

/** The viewer reports a view state; wrap it in act(). */
export function emitState(state: ModelViewState): void {
  fake.props?.onState?.(state);
}

export const FakeModelViewer = forwardRef<ModelViewerHandle, ModelViewerProps>(
  function FakeModelViewer(props, ref) {
    const latest = useRef(props);
    useEffect(() => {
      latest.current = props;
      fake.props = props;
    });
    useImperativeHandle(ref, () => {
      const rec =
        (name: string) =>
        (...args: unknown[]) => {
          fake.calls.push({ name, args });
        };
      return {
        setGroupVisible: rec("setGroupVisible"),
        select: rec("select"),
        setCut: rec("setCut"),
        setLevels: rec("setLevels"),
        setHeadOff: rec("setHeadOff"),
        setOverlay: rec("setOverlay"),
        setView: rec("setView"),
      } as ModelViewerHandle;
    }, []);
    return <div data-testid="fake-model-viewer" />;
  },
);
