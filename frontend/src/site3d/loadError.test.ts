import { describe, expect, it } from "vitest";
import { httpStatusOf, loadFailureText } from "./loadError";

const LEAKY = 'fetch for "http://127.0.0.1:8000/api/v1/x/glb?token=s3cr3t" responded with 404: Not Found';

describe("loadFailureText", () => {
  it("a loader error naming a token URL keeps only the status", () => {
    const err = Object.assign(new Error(LEAKY), { response: { status: 404 } });
    const text = loadFailureText("The 3D model could not load", err);
    expect(text).toBe("The 3D model could not load (HTTP 404).");
    expect(text).not.toMatch(/token|http:|s3cr3t|\?/i);
  });

  it("reads the status from the message when there is no response", () => {
    expect(httpStatusOf(new Error(LEAKY))).toBe(404);
    expect(httpStatusOf(new Error("HTTP 403"))).toBe(403);
    expect(httpStatusOf({ status: 500 })).toBe(500);
  });

  it("no status: the lead alone, never the error's text", () => {
    expect(loadFailureText("The cloud could not load", new Error("bad URL http://x/?token=s3cr3t"))).toBe(
      "The cloud could not load.",
    );
    expect(loadFailureText("The cloud could not load", "boom")).toBe("The cloud could not load.");
  });
});
