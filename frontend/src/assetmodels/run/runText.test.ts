import { describe, expect, it } from "vitest";
import { phaseLabel, stopReasonText, thumbUrl, tokensText } from "./runText";

describe("run text", () => {
  it("labels phases", () => {
    expect(phaseLabel("sampling")).toBe("Sampling the scan");
    expect(phaseLabel("checking")).toBe("Checking");
  });

  it("explains why a run stopped", () => {
    expect(stopReasonText({ state: "stopped", stop_reason: "budget" })).toBe(
      "Stopped: the run used its budget",
    );
    expect(stopReasonText({ state: "stopped", stop_reason: "user" })).toBe("Stopped by you");
    expect(stopReasonText({ state: "failed", stop_reason: "interrupted" })).toBe(
      "Interrupted when the app closed",
    );
    expect(stopReasonText({ state: "finished", stop_reason: null })).toBeNull();
  });

  it("formats token use", () => {
    expect(tokensText({ input_tokens: 1_150_000, output_tokens: 80_000 })).toBe("1.2 M tokens");
    expect(tokensText({ input_tokens: 9_000, output_tokens: 500 })).toBe("9.5 k tokens");
  });

  it("builds a token-bearing thumbnail url", () => {
    expect(thumbUrl("http://h:1/", "a b", "p", "m", "r", 3)).toBe(
      "http://h:1/api/v1/projects/p/asset-models/m/runs/r/steps/3/thumb?token=a%20b",
    );
  });
});
