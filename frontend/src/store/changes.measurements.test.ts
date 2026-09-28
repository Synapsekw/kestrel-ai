import { beforeEach, describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

const event = (type: string, project_id = "A") =>
  ({
    type,
    project_id,
    job_id: null,
    progress: null,
    message: "",
    payload: {},
  }) as unknown as AppEvent;

describe("measurementsRevision", () => {
  beforeEach(() =>
    useChangesStore.setState({
      measurementsRevision: 0,
      volumesRevision: 0,
      openProjectId: null,
    }),
  );

  it.each(["map_measurements.changed", "volumes.changed", "pointclouds.changed"])("%s bumps it", (type) => {
    useChangesStore.getState().applyEvent(event(type));
    expect(useChangesStore.getState().measurementsRevision).toBe(1);
  });

  it("volumes.changed still bumps the volume view's own revision", () => {
    useChangesStore.getState().applyEvent(event("volumes.changed"));
    expect(useChangesStore.getState().volumesRevision).toBe(1);
  });

  it.each(["map_measurements.changed", "volumes.changed", "pointclouds.changed"])(
    "%s of another project is ignored while a project is open",
    (type) => {
      const s = useChangesStore.getState();
      s.setOpenProject("A");
      s.applyEvent(event(type, "B"));
      expect(useChangesStore.getState().measurementsRevision).toBe(0);
      s.applyEvent(event(type, "A"));
      expect(useChangesStore.getState().measurementsRevision).toBe(1);
    },
  );

  it("findings.changed does not touch it", () => {
    useChangesStore.getState().applyEvent(event("findings.changed"));
    expect(useChangesStore.getState().measurementsRevision).toBe(0);
  });

  // IMC reconciliation item 3: one `if` per event, so W1's and C-W1's revisions still bump.
  it("map_measurements.changed still bumps M-W1's mapMeasurementsRevision", () => {
    useChangesStore.setState({ mapMeasurementsRevision: 0 });
    useChangesStore.getState().applyEvent(event("map_measurements.changed"));
    expect(useChangesStore.getState().mapMeasurementsRevision).toBe(1);
  });

  it("pointclouds.changed still bumps C-W1's pointcloudsRevision", () => {
    useChangesStore.setState({ pointcloudsRevision: 0 });
    useChangesStore.getState().applyEvent(event("pointclouds.changed"));
    expect(useChangesStore.getState().pointcloudsRevision).toBe(1);
  });
});
