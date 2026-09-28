import { afterEach, describe, expect, it } from "vitest";
import { PULSE_CYCLES, PULSE_PERIOD_MS, pulseFrame, usePulseStore } from "./pulse";

describe("the finding ring pulse", () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
    usePulseStore.setState({ started: {} });
  });

  it("grows and fades each cycle and stops after three cycles", () => {
    expect(PULSE_CYCLES).toBe(3);
    expect(pulseFrame(0)).toEqual({ radius: 10, alpha: 1 });
    expect(pulseFrame(PULSE_PERIOD_MS / 2)).toEqual({ radius: 17, alpha: 0.5 });
    expect(pulseFrame(PULSE_PERIOD_MS * PULSE_CYCLES)).toBeNull();
    expect(pulseFrame(-1)).toBeNull();
  });

  it("records a pulse and prunes it once it is over", () => {
    usePulseStore.getState().pulse("f1", 1000);
    expect(usePulseStore.getState().started).toEqual({ f1: 1000 });
    usePulseStore.getState().prune(1000 + PULSE_PERIOD_MS * PULSE_CYCLES);
    expect(usePulseStore.getState().started).toEqual({});
  });

  it("never pulses under reduced motion", () => {
    document.documentElement.dataset.motion = "reduced";
    usePulseStore.getState().pulse("f1", 1000);
    expect(usePulseStore.getState().started).toEqual({});
  });
});
