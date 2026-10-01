import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/reports/preview.css", "utf8");
const preview = readFileSync("src/reports/ReportPreview.tsx", "utf8");

// R10 task 6c: an unregistered `--mm` carries `100cqw` into every printed length of every sheet, so each
// layout inside the preview's size container re-resolved the whole 300-finding subtree (110-160 ms
// frames while scrolling). Registered as a <length>, it computes to px once, on the column.
// A structural pin only: jsdom has no layout, so it cannot show the effect; the behavioural guard is
// e2e/reports-scale.spec.ts (E2E_FRAME_BUDGET=1).
describe("preview.css", () => {
  it("registers --mm as an inherited <length>", () => {
    const rule = css.match(/@property --mm \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/syntax: "<length>";/);
    expect(rule).toMatch(/inherits: true;/);
    expect(rule).toMatch(/initial-value: 1mm;/);
  });

  it("is imported by ReportPreview", () => {
    expect(preview).toContain('import "./preview.css";');
  });
});
