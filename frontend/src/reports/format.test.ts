import { describe, expect, it } from "vitest";
import { ApiFailure } from "@/api/errors";
import { stats, version } from "@/test/reportBuilderFixtures";
import {
  lastVersionLine,
  matchLine,
  pagesLabel,
  saveErrorText,
  shortDate,
  versionError,
  versionName,
  versionPages,
  versionParts,
} from "./format";

describe("reports format", () => {
  it("writes short UTC dates", () => {
    expect(shortDate("2026-09-24T23:30:00Z")).toBe("24 Sep");
    expect(shortDate(null)).toBe("");
    expect(shortDate("nope")).toBe("");
  });

  it("names versions, with no name while a render has no number", () => {
    expect(versionName(3)).toBe("v3");
    expect(versionName(null)).toBe("");
  });

  it("writes the list card's version line", () => {
    expect(lastVersionLine(null)).toBe("No versions yet");
    expect(lastVersionLine({ number: 3, state: "ready", issued_at: "2026-09-24T12:00:00Z", pages: 38 })).toBe(
      "Issued v3 · 24 Sep",
    );
    expect(lastVersionLine({ number: 2, state: "ready", issued_at: null, pages: 10 })).toBe("Draft v2");
    expect(lastVersionLine({ number: null, state: "rendering", issued_at: null, pages: null })).toBe(
      "Rendering…",
    );
    expect(lastVersionLine({ number: null, state: "failed", issued_at: null, pages: null })).toBe(
      "Render failed",
    );
  });

  it("counts pages and parts", () => {
    expect(pagesLabel(1)).toBe("1 page");
    expect(pagesLabel(38)).toBe("38 pages");
    expect(pagesLabel(null)).toBe("");
    expect(versionPages(version(1))).toBe(38);
    expect(versionPages(version(1, { stats: stats() }))).toBe(38); // from the PDF file
    expect(versionParts(version(1, { stats: stats({ part_count: 2 }) }))).toBe(2);
    expect(versionParts(version(1, { stats: stats() }))).toBe(1);
  });

  it("reads a failed render's message", () => {
    expect(
      versionError(
        version(1, { state: "failed", number: null, stats: stats({ error: "The disk is full" }) }),
      ),
    ).toBe("The disk is full");
    expect(versionError(version(1))).toBeNull();
  });

  it("writes the live match line", () => {
    expect(matchLine(null)).toBe("Counting findings…");
    expect(matchLine(0)).toBe("No findings match");
    expect(matchLine(1)).toBe("1 finding matches");
    expect(matchLine(38)).toBe("38 findings match");
  });

  it("names the field a refused save points at", () => {
    const err = new ApiFailure("invalid_report", "The report is not valid", 422, {
      errors: [{ path: "config.filters.date.days", message: "must be at least 1" }],
    });
    expect(saveErrorText(err)).toBe("config.filters.date.days: must be at least 1");
    expect(saveErrorText(new Error("offline"))).toBe("offline");
  });
});
