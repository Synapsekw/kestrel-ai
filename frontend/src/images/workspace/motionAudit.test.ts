import { expect, it } from "vitest";

const sources = import.meta.glob<string>(["/src/images/**/*.tsx", "!/src/images/**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

it("every animation under src/images honours reduced motion (§12)", () => {
  expect(Object.keys(sources).length).toBeGreaterThan(0);
  const offenders: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    text.split("\n").forEach((line, i) => {
      if (/\banimate-(rise|pop|reveal|slide-in|fade)\b/.test(line) && !line.includes("reduce-motion:"))
        offenders.push(`${file}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});
