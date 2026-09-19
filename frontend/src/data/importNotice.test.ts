import { describe, it, expect } from "vitest";
import { runningJob } from "@/test/fixtures";
import { importNotice } from "./importNotice";

const job = { ...runningJob, type: "import" as const };

describe("importNotice", () => {
  it("says the import is running, with the progress message when there is one", () => {
    expect(importNotice(job, "D:/frames")).toEqual({
      tone: "info",
      text: `Importing D:/frames… ${job.message}`.trim(),
    });
  });

  it("summarises a finished import", () => {
    const done = {
      ...job,
      state: "succeeded" as const,
      result: { source_id: "s", imported: 40, duplicates: 2, failed: 0, skipped: 3 },
    };
    expect(importNotice(done, "D:/frames")).toEqual({
      tone: "ok",
      text: "Import finished: 40 images added, 2 duplicates left out, 3 already imported.",
    });
  });

  it("points at the job log when files failed or the job did", () => {
    const partly = {
      ...job,
      state: "succeeded" as const,
      result: { imported: 1, duplicates: 0, failed: 2, skipped: 0 },
    };
    expect(importNotice(partly, "x")).toEqual({
      tone: "warn",
      text: "Import finished: 1 image added, 2 files could not be read (see the job log).",
    });
    expect(importNotice({ ...job, state: "failed" as const, error: "disk full" }, "x")).toEqual({
      tone: "error",
      text: "Import failed: disk full",
    });
    expect(importNotice({ ...job, state: "cancelled" as const }, "x")).toEqual({
      tone: "warn",
      text: "Import cancelled. Images prepared so far are kept; start it again to continue.",
    });
  });

  it("tells a user who imported a folder without images", () => {
    const none = {
      ...job,
      state: "succeeded" as const,
      result: { imported: 0, duplicates: 0, failed: 0, skipped: 0 },
    };
    expect(importNotice(none, "x").text).toBe("Import finished: no image files were found in that folder.");
  });
});
