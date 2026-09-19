# Site office UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole frontend into the "Site office" design (light stone neutrals, one orange accent, pipeline navigation, one component set, state-only motion) so a non-technical user always sees where the project stands and what to do next.

**Architecture:** Tokens as CSS variables mapped into Tailwind names; a `src/ui/` component set that every screen uses instead of raw elements and class strings; the shell computes pipeline step states from one `useProjectProgress` hook; two new routes (Home, Label resolver). Screens are restyled one group at a time, each group keeping its unit and e2e tests green.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind 3.4, Vitest + Testing Library, Playwright against the Prism mock. Font `@fontsource-variable/instrument-sans`.

**Spec:** `docs/superpowers/specs/2026-09-19-site-office-ui-design.md` (design system: `DESIGN.md`, product context: `PRODUCT.md`).

## Global Constraints

- No backend or contract change. Existing route paths stay; only labels change.
- Every screen uses `src/ui/` components; no raw `<button>`, `<input>`, `<select>`, `<textarea>` outside `src/ui/` when the task is done (the Konva canvas and `<table>` markup are fine).
- No `slate-`, `orange-`, `emerald-`, `amber-`, `red-`, `sky-` Tailwind classes in `src/` outside `src/ui/tokens.ts` (checked by `frontend/scripts/check-tokens.mjs`).
- Copy: Images (not Data), Label (not Editor), Detect (not Query), Project settings, suggestions (not proposals), "Accept as labels" (not Promote), flight (not group) where the group is a flight. Sentence case. No em dashes.
- Motion only for state; 140 ms hover and press, 180 ms reveals, 220 ms drawers and dialogs; `motion-reduce` variants everywhere a transform moves; nothing animates on a hotkey in the editor.
- Each task ends with `pnpm lint`, `pnpm test` and (when e2e files change) `pnpm e2e` green in `frontend/`, and one commit.
- Tests are updated, never deleted. New behaviour gets a test first.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

Create:
- `frontend/src/ui/tokens.ts` (the single place allowed to mention raw Tailwind palette names; exports the shared class strings such as `focusRing`)
- `frontend/src/ui/Button.tsx`, `IconButton.tsx`, `Input.tsx`, `Textarea.tsx`, `Select.tsx`, `Checkbox.tsx`, `Switch.tsx`, `Field.tsx`, `Pill.tsx`, `Alert.tsx`, `Progress.tsx`, `Skeleton.tsx`, `EmptyState.tsx`, `Segmented.tsx`, `Kbd.tsx`, `Dialog.tsx`, `Disclosure.tsx`, `Icon.tsx`, `Tooltip.tsx`, `Toaster.tsx`, `toastStore.ts`, `useJobToasts.ts`, `index.ts` and their tests
- `frontend/src/app/pipeline.ts` + test, `frontend/src/app/useProjectProgress.ts` + test, `frontend/src/store/progress.ts`
- `frontend/src/app/Sidebar.tsx` + test, `frontend/src/app/Header.tsx`, `frontend/src/app/Brand.tsx`
- `frontend/src/screens/HomeScreen.tsx` + test, `frontend/src/screens/LabelResolverScreen.tsx` + test
- `frontend/scripts/check-tokens.mjs`
- `docs/evidence/ui/2026-09-19-site-office/` (screenshots)

Modify: `frontend/src/index.css`, `frontend/tailwind.config.ts`, `frontend/package.json`, `frontend/src/main.tsx`, `frontend/src/app/Shell.tsx`, `NextStepBar.tsx`, `nextStep.ts`, `Splash.tsx`, `ErrorBoundary.tsx`, `frontend/src/routes.tsx`, every screen and component under `src/screens`, `src/data`, `src/editor`, `src/jobs`, `src/models`, `src/query`, `src/settings`, `src/train`, `src/datasets`, their tests, `frontend/e2e/*.spec.ts`, `frontend/scripts/usability_walkthrough.mjs`, `frontend/scripts/checkpoint3.mjs` and `acceptance` driver selectors if they name renamed screens, `docs/progress.md`.

---

### Task 1: Tokens, font, Tailwind mapping, token check script

**Files:**
- Modify: `frontend/src/index.css`, `frontend/tailwind.config.ts`, `frontend/package.json`, `frontend/src/main.tsx`
- Create: `frontend/src/ui/tokens.ts`, `frontend/scripts/check-tokens.mjs`

**Interfaces:**
- Produces: Tailwind colour names listed in the spec section 1; `animate-reveal`, `animate-pop`, `animate-shimmer`, `animate-pulse-dot`; `shadow-float`; `ease-out-quart` timing via `ease-[var(--ease-out)]`; `duration-140`; `tokens.ts` exports `focusRing`, `pressable`, `transition`.

- [ ] **Step 1: Install the font**

Run in `frontend/`: `pnpm add @fontsource-variable/instrument-sans`

- [ ] **Step 2: Write the tokens into `index.css`**

```css
@import "@fontsource-variable/instrument-sans";
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --ground: 245 245 241; --side: 235 236 230; --panel: 255 255 255; --well: 230 231 225;
    --hover: 30 32 26; --ink: 31 34 29; --muted: 106 111 102; --dim: 169 173 164;
    --line: 220 221 214; --line-strong: 195 198 189;
    --accent: 217 72 15; --accent-hover: 194 63 11; --accent-soft: 251 234 223; --accent-ink: 138 47 8; --accent-line: 240 205 184;
    --ok: 47 125 79; --ok-soft: 223 241 229; --warn: 185 130 0; --warn-strong: 224 164 0; --warn-soft: 251 240 199;
    --danger: 180 35 24; --danger-soft: 253 232 230; --inverse: 31 34 29; --inverse-fg: 245 245 241; --canvas: 35 39 34;
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  }
  html, body, #root { @apply h-full; }
  body { @apply bg-ground text-ink antialiased; font-feature-settings: "cv11", "ss01"; }
  ::selection { @apply bg-accent-soft text-accent-ink; }
}
```

- [ ] **Step 3: Map them in `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";
const rgb = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: rgb("ground"), side: rgb("side"), panel: rgb("panel"), well: rgb("well"),
        hover: "rgb(var(--hover) / 0.06)", ink: rgb("ink"), muted: rgb("muted"), dim: rgb("dim"),
        line: rgb("line"), "line-strong": rgb("line-strong"),
        accent: rgb("accent"), "accent-hover": rgb("accent-hover"), "accent-soft": rgb("accent-soft"),
        "accent-ink": rgb("accent-ink"), "accent-line": rgb("accent-line"),
        ok: rgb("ok"), "ok-soft": rgb("ok-soft"), warn: rgb("warn"), "warn-strong": rgb("warn-strong"), "warn-soft": rgb("warn-soft"),
        danger: rgb("danger"), "danger-soft": rgb("danger-soft"), inverse: rgb("inverse"), "inverse-fg": rgb("inverse-fg"), canvas: rgb("canvas"),
      },
      fontFamily: { sans: ['"Instrument Sans Variable"', '"Segoe UI"', "system-ui", "sans-serif"] },
      borderRadius: { md: "7px", lg: "10px" },
      boxShadow: { float: "0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px -12px rgb(31 34 29 / 0.35)" },
      transitionDuration: { 140: "140ms", 180: "180ms", 220: "220ms" },
      transitionTimingFunction: { out: "var(--ease-out)" },
      keyframes: {
        reveal: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pop: { from: { opacity: "0", transform: "scale(.97)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
        "pulse-dot": { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
      },
      animation: {
        reveal: "reveal 180ms var(--ease-out) both", pop: "pop 220ms var(--ease-out) both",
        shimmer: "shimmer 1.4s linear infinite", "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: `src/ui/tokens.ts`**

```ts
/** Shared class fragments. The only file allowed to name raw Tailwind palette colours (it names none today). */
export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground";
export const transition = "transition-[background-color,border-color,color,transform,box-shadow,opacity] duration-140 ease-out motion-reduce:transition-none";
export const pressable = "active:scale-[.97] motion-reduce:active:scale-100";
export const disabled = "disabled:opacity-45 disabled:pointer-events-none";
```

- [ ] **Step 5: `scripts/check-tokens.mjs`**

```js
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const bad = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|divide|placeholder)-(?:slate|orange|emerald|amber|red|sky|gray|zinc|neutral|stone|green|yellow|blue)-\d{2,3}\b/;
const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(name) && !p.endsWith("ui\\tokens.ts") && !p.endsWith("ui/tokens.ts")) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => { if (bad.test(line)) hits.push(`${p}:${i + 1}: ${line.trim()}`); });
    }
  }
}
walk("src");
if (hits.length) { console.error(hits.join("\n")); process.exit(1); }
console.log("tokens ok");
```

Add to `package.json` scripts: `"lint": "eslint src && prettier --check src && node scripts/check-tokens.mjs"`. It fails now (every screen still uses slate); that is expected until Task 12. Until then run it by hand to watch the count go down.

- [ ] **Step 6: `main.tsx` imports nothing new (the font comes through `index.css`). Build once**

Run: `pnpm build` in `frontend/`. Expected: success, the font file is in `dist/assets`.

- [ ] **Step 7: Commit**

`git commit -m "feat(ui): site office tokens, font and token check"`

---

### Task 2: The `ui` component set

**Files:** Create every file listed under `frontend/src/ui/` in the file structure, plus `index.ts` re-exporting them. Tests: `Button.test.tsx`, `Dialog.test.tsx`, `Toaster.test.tsx`, `Switch.test.tsx`, `Disclosure.test.tsx`, `Tooltip.test.tsx`, `Field.test.tsx`.

**Interfaces (produced, used by every later task):**

```ts
// Icon.tsx
export type IconName = "folder" | "images" | "label" | "datasets" | "train" | "detect" | "review" | "models" | "settings" | "home" | "search" | "chevron-down" | "chevron-right" | "check" | "x" | "plus" | "import" | "play" | "trash" | "undo" | "redo" | "fit" | "one-to-one" | "keyboard" | "grid" | "list" | "warning" | "info" | "external" | "spinner" | "arrow-left" | "arrow-right" | "hard-hat";
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }): JSX.Element;
// Button.tsx
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean; icon?: IconName; }
export const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;
export function IconButton(props: Omit<ButtonProps, "children" | "icon"> & { icon: IconName; label: string }): JSX.Element;
// Input.tsx / Textarea.tsx / Select.tsx: forwardRef wrappers of the native element with `invalid?: boolean`; Select renders <span class="relative"> <select/> <Icon name="chevron-down"/> </span>
// Checkbox.tsx: forwardRef<HTMLInputElement, InputHTMLAttributes & { label?: ReactNode }>; renders a visually hidden native checkbox plus the drawn box, so `getByRole("checkbox")` and `userEvent.click` keep working
// Switch.tsx: ({ checked, onChange, label, disabled }) role="switch" button
// Field.tsx: ({ label, htmlFor, hint, error, children, className }); error rendered in <p role="alert" id={`${htmlFor}-error`}>
// Pill.tsx: ({ tone = "neutral", live, children, className })
// Alert.tsx: ({ tone = "info", title, onDismiss, children, className, testId }) role alert for danger, status otherwise
// Progress.tsx: ({ value, running, label }) value undefined => indeterminate
// Skeleton.tsx: Skeleton({ className }), SkeletonRows({ rows = 6, columns = 4 })
// EmptyState.tsx: ({ icon, title, children, action })
// Segmented.tsx: <T extends string>({ options: { value: T; label: string; icon?: IconName }[]; value: T; onChange(v: T); label: string })  role="radiogroup"
// Kbd.tsx: ({ children })
// Dialog.tsx: ({ open, title, onClose, children, footer, width = "md" | "lg", describedBy }) role="dialog" aria-modal="true"; traps focus; Escape and backdrop close; restores focus on close
// Disclosure.tsx: ({ label = "More options", defaultOpen = false, children, id }) button aria-expanded + region
// Tooltip.tsx: ({ label, children, side = "top" }) wraps children in a span; shows on hover/focus after 400 ms
// toastStore.ts: export interface Toast { id: string; tone: "info" | "ok" | "danger"; text: string; action?: { label: string; onClick(): void } }; export const useToastStore; export function toast(tone, text, action?): string; export function dismissToast(id)
// Toaster.tsx: renders the store, max 3, auto-dismiss 6 s paused on hover
// useJobToasts.ts: useJobToasts(projectId) watches useJobsStore for jobs that go from active to terminal and calls toast() with the texts of spec section 1
```

- [ ] **Step 1: Write the failing tests** (`Button.test.tsx` shown; write the others in the same style: render, interact with `userEvent`, assert on roles and text)

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

test("loading disables the button and keeps its label", () => {
  render(<Button loading>Save</Button>);
  const b = screen.getByRole("button", { name: /save/i });
  expect(b).toBeDisabled();
  expect(b).toHaveAttribute("aria-busy", "true");
});

test("clicks fire when enabled", async () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Go</Button>);
  await userEvent.click(screen.getByRole("button", { name: "Go" }));
  expect(onClick).toHaveBeenCalledTimes(1);
});
```

Dialog test: opens with focus inside, Escape calls `onClose`, focus returns to the trigger. Toaster test: `toast("ok","A")` shows "A"; four toasts show three; the dismiss button removes one. Switch: Space toggles and calls `onChange(true)`. Disclosure: content absent until the button is clicked; `aria-expanded` flips. Tooltip: label appears in the document on focus (use fake timers, advance 400 ms). Field: `error` renders with `role="alert"` and `aria-describedby` links input and error.

If `@testing-library/user-event` is not installed: `pnpm add -D @testing-library/user-event`.

- [ ] **Step 2: Run them, expect failures (modules missing)**

`pnpm test src/ui`

- [ ] **Step 3: Implement the components**

Button, written out (the others follow its shape):

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";
import { disabled, focusRing, pressable, transition } from "./tokens";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: IconName;
}

const VARIANT = {
  primary: "bg-accent text-white border-transparent hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]",
  secondary: "bg-panel text-ink border-line hover:bg-hover hover:border-line-strong",
  ghost: "bg-transparent text-ink border-transparent hover:bg-hover",
  danger: "bg-panel text-danger border-line hover:bg-danger-soft hover:border-danger/40",
} as const;
const SIZE = { sm: "h-7 px-2.5 text-[13px] gap-1.5", md: "h-9 px-3.5 text-sm gap-2" } as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, className = "", children, type = "button", disabled: isDisabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border font-medium ${VARIANT[variant]} ${SIZE[size]} ${transition} ${pressable} ${focusRing} ${disabled} ${className}`}
      {...rest}
    >
      {loading ? <Icon name="spinner" size={size === "sm" ? 12 : 14} className="animate-spin motion-reduce:animate-none" /> : icon ? <Icon name={icon} size={size === "sm" ? 13 : 15} /> : null}
      {children}
    </button>
  );
});
```

Icons: hand-written 24-viewbox line paths (stroke 1.75, round caps), one `<path d>` per name in a `const PATHS: Record<IconName, string>`; the `hard-hat` mark is a dome on a brim. Keep every path short; no icon library.

Dialog: render into `document.body` with `createPortal`; backdrop `bg-ink/40`, panel `bg-panel rounded-lg shadow-float animate-pop motion-reduce:animate-none max-w-[min(100%-2rem,40rem)]`; focus trap by cycling Tab inside; `useEffect` stores `document.activeElement` on open and refocuses it on close.

Toaster: fixed bottom-right, `flex-col gap-2`, each toast `bg-inverse text-inverse-fg rounded-md shadow-float animate-reveal` with the tone icon (ok: green check circle, danger: warning), text, optional action `Button size="sm" variant="ghost"` in inverse colours, and an `IconButton icon="x" label="Dismiss"`.

useJobToasts: keep a `Set` of active job ids seen; on subscribe, for each job that leaves the active set: `import` -> `ok` "Import finished: N images" using the job's `result` counts if present, else the message; `train` -> "Training finished: model registered" (name from result when present); `infer` -> "Detection finished" + message; `dataset` -> "Dataset ready"; `failed` -> `danger` with the job message and action "Show log" that calls `useJobsStore.getState().setPanelOpen(true)`; `cancelled` -> `info` "<type> cancelled". Read the `Job` type in `contract/client` for the exact fields before writing this.

- [ ] **Step 4: Tests pass**

`pnpm test src/ui` green; `pnpm lint` green (the token check is allowed to fail at this stage; run `eslint src && prettier --check src` directly).

- [ ] **Step 5: Commit** `feat(ui): component set (buttons, fields, pills, alerts, dialog, toasts, icons)`

---

### Task 3: Pipeline states and project progress hook

**Files:**
- Create: `frontend/src/app/pipeline.ts`, `pipeline.test.ts`, `frontend/src/app/useProjectProgress.ts`, `useProjectProgress.test.tsx`, `frontend/src/store/progress.ts`
- Modify: `frontend/src/app/nextStep.ts` (add `queryRuns: number` to `ProjectProgress`, and shorten the texts to the copy below), `nextStep.test.ts`, `frontend/src/app/NextStepBar.tsx` (consume the hook)

**Interfaces:**

```ts
// pipeline.ts
export type StepId = "images" | "label" | "datasets" | "train" | "detect" | "review";
export type StepState = "done" | "current" | "upcoming" | "locked";
export interface Step { id: StepId; label: string; path: string; state: StepState; count: string | null; lockedReason: string | null; }
export const STEP_ORDER: readonly StepId[];
export function stepStates(projectId: string, p: ProjectProgress): Step[];
// useProjectProgress.ts
export function useProjectProgress(projectId: string | undefined): { progress: ProjectProgress | null; refresh(): void };
// store/progress.ts: zustand { byProject: Record<string, ProjectProgress>; set(projectId, p) }
```

Rules (from spec section 2): counts: images `String(images)`, label `${labeled} / ${images}`, datasets `String(datasets)`, train `String(trainedModels)`, detect `null`, review `pendingReview > 0 ? String(pendingReview) : null`. Locked reasons: label and datasets "Import images first"; train "Create a dataset first"; detect "Train a model or add a starter model first" when `models === 0`; review "Run a detection first" when `queryRuns === 0 && pendingReview === 0`.

`nextStep` copy (short, the banner adds the explanation): "Review 12 suggestions" / "Import images" / "Label your images" / "Keep labeling, or create a dataset" / "Create a dataset" / "Add a starter model" / "Train a model" / "Run detection on 26 unlabeled images". Add `detail: string` to `NextStep` with the existing longer sentence.

- [ ] **Step 1: Write `pipeline.test.ts`** covering: empty project (images current, everything else locked except nothing), 40 images 0 labeled (images done, label current, datasets locked with reason), labeled + dataset + trained model + no run (detect current, review locked), pendingReview > 0 (review current regardless), all done (no current).
- [ ] **Step 2: Run, fail.** `pnpm test src/app/pipeline`
- [ ] **Step 3: Implement `pipeline.ts`, `store/progress.ts`, `useProjectProgress.ts`** (move the effect out of `NextStepBar`; add `fetchQueryRuns` from `src/api/queryRuns.ts` to the `Promise.all`; on success `useProgressStore.getState().set(projectId, value)`; the hook returns the store value for the project).
- [ ] **Step 4: Update `nextStep.ts`, its test, `NextStepBar.tsx`** (bar now reads the hook; keep `data-testid="next-step"`).
- [ ] **Step 5: All tests green, commit** `feat(app): pipeline step states and a shared project progress hook`

---

### Task 4: Shell: sidebar, header, next-step banner, toaster, splash, error boundary

**Files:**
- Create: `frontend/src/app/Sidebar.tsx`, `Sidebar.test.tsx`, `Header.tsx`, `Brand.tsx`
- Modify: `frontend/src/app/Shell.tsx`, `Shell.test.tsx`, `NextStepBar.tsx`, `NextStepBar.test.tsx`, `Splash.tsx`, `ErrorBoundary.tsx`, `frontend/src/jobs/JobsButton.tsx`, `JobsPanel.tsx` (drawer surface only; cards in Task 11), `frontend/e2e/boot.spec.ts`

Sidebar markup per entry (`NavLink`), from the `Step` list:

```tsx
<NavLink to={step.path} className={({ isActive }) => `group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium ${transition} ${focusRing} ${isActive ? "bg-panel text-ink shadow-sm" : "text-ink/75 hover:bg-hover hover:text-ink"} ${step.state === "locked" ? "text-dim pointer-events-none" : ""}`} aria-disabled={step.state === "locked" || undefined}>
  <StepMark state={step.state} n={index + 1} />
  <span className="truncate">{step.label}</span>
  {step.count && <span className="ml-auto text-xs tabular-nums text-muted">{step.count}</span>}
</NavLink>
```

Locked entries are wrapped in `Tooltip label={step.lockedReason}`. `StepMark`: 18px circle as in the spec. "Home" above the steps with the house icon; "Models" and "Project settings" below with icons; "App settings" at the bottom after `mt-auto` and a top border.

Header: breadcrumb from the route (`useMatches` is not configured; derive the screen name from the pathname with a small map in `Header.tsx`), running pill from `useJobsStore` (newest active job's `message` or "N jobs running"), `JobsButton` as `Button variant="ghost" size="sm" icon="list"` with `aria-controls` kept.

Next-step banner: `div.animate-reveal` keyed by `step.text` so it re-reveals when the text changes; six `StepTicks` (26x5 px bars: done ok, current accent, else well); primary `Button` "Go" with the step text as the label ("Label your images").

Splash and ErrorBoundary as spec section 4.

- [ ] **Step 1: Tests first** (`Sidebar.test.tsx`: renders the six steps with the states from a given progress, locked entries have `aria-disabled` and the reason in a tooltip on focus; `Shell.test.tsx` updated for the new labels; `NextStepBar.test.tsx` updated).
- [ ] **Step 2: Implement.** Remove `projectNavItems`/`NavEntry` from `Shell.tsx`; mount `<Toaster />` and call `useJobToasts(projectId)` in `Shell`.
- [ ] **Step 3: `pnpm test`, `pnpm e2e e2e/boot.spec.ts`** (update the disabled-entry assertion text: the hint is now the tooltip reason "Import images first").
- [ ] **Step 4: Commit** `feat(shell): pipeline sidebar, header with running pill, next-step banner, toasts`

---

### Task 5: Home screen and Label resolver

**Files:**
- Create: `frontend/src/screens/HomeScreen.tsx`, `HomeScreen.test.tsx`, `frontend/src/screens/LabelResolverScreen.tsx`, `LabelResolverScreen.test.tsx`
- Modify: `frontend/src/routes.tsx` (add `{ path: "p/:projectId", element: <HomeScreen /> }` and `{ path: "p/:projectId/label", element: <LabelResolverScreen /> }`), `frontend/src/screens/ProjectsScreen.tsx` (`openProject` navigates to `/p/${id}`), `ProjectsScreen.test.tsx`, `frontend/e2e/boot.spec.ts` (+ "Label opens the first unlabeled image")

Home layout: `max-w-3xl` column: title (project name, 20px semibold), folder in `font-mono text-muted text-xs`; the next-step card (`bg-accent-soft border-accent-line rounded-lg p-4`, title, detail, primary button); "Where this project stands" as a two-column definition list (`dl` with `grid-cols-[auto_1fr]`), rows from `ProjectProgress` plus `Stats.marked_empty_count` if the stats carry it (check `contract/client` `Stats`; otherwise omit the row); "Running now": active jobs from `useJobsStore` with `Progress running` each, or muted "Nothing running".

Label resolver: `fetchImages(api, projectId, { labeled: false, marked_empty: false, limit: 1, sort: "file", order: "asc" })` (read `src/api/images.ts` for the actual parameter shape; use `toImageParams` from `src/data/listModel.ts` if it fits); on a hit `useNavigationStore.getState().setContext([hit.id, ...], "data", `/p/${projectId}/data`)` is not enough for Next/Previous to walk the unlabeled set, so fetch the first page (`IMAGE_PAGE_SIZE`) of unlabeled ids for the context, then `navigate(`/p/${projectId}/edit/${first}`, { replace: true })`; when the page is empty and `images > 0`: `navigate(`/p/${projectId}/data?notice=all-labeled`, { replace: true })`; when no images at all: `navigate(`/p/${projectId}/data`, { replace: true })`. `DataManagerScreen` reads `notice=all-labeled` once and shows `Alert ok` "Every image is labeled. Create a dataset next." with a link to Datasets.

- [ ] **Step 1: Tests first** (Home renders counts and the next step from a mocked API; resolver: three outcomes with `MemoryRouter` and a route listener).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: `pnpm test`, `pnpm e2e e2e/boot.spec.ts`.** Commit `feat(app): project home and the Label step resolver`

---

### Task 6: Projects screen

**Files:** Modify `frontend/src/screens/ProjectsScreen.tsx`, `ProjectsScreen.test.tsx`; e2e `boot.spec.ts` if it creates a project by button text.

Layout: `grid gap-10 lg:grid-cols-[1fr_minmax(20rem,26rem)]`. Left: "Recent projects" list, each row `flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 hover:border-line-strong transition` with name (font-medium), folder (`font-mono text-xs text-muted truncate`), `Button variant="ghost" size="sm"` Remove, `Button variant="primary" size="sm"` Open; the inline confirm stays but on `Alert tone="warn"` with two buttons. Empty: `EmptyState icon="folder" title="No projects yet"` "Create one on the right, or open a folder that already holds a project." Right: "Create a project" (`Field` Name, `Field` Folder with the Browse `Button`, the default classes as `Pill`s and a `Disclosure label="Edit the class list"` holding the `Textarea`), primary "Create project"; below, "Open a project folder" with `Field` + secondary "Open folder". Errors: `Alert danger` at the top of the column that raised them.

- [ ] Steps: update tests for the new button names (same names, so mostly unchanged), implement, `pnpm test src/screens/ProjectsScreen`, commit `feat(projects): site office layout`.

---

### Task 7: Images screen, dialogs, thumbnails, table

**Files:** Modify `frontend/src/screens/DataManagerScreen.tsx`, `frontend/src/data/FilterBar.tsx`, `ImageGrid.tsx`, `ImageTable.tsx`, `SelectionBar.tsx`, `EmptyImages.tsx`, `ImportImagesDialog.tsx`, `AddToDatasetDialog.tsx` and their tests; e2e `data-manager.spec.ts`, `import.spec.ts`, `datasets.spec.ts` (heading "Data Manager" becomes "Images").

Mapping rules:
- Title "Images". Keyboard hint: `IconButton icon="keyboard" label="Keyboard shortcuts"` opening a small popover (same pattern as the editor's Keys popover) listing J / K, Enter, Space, Ctrl+A with `Kbd`.
- FilterBar: each control in `Field` (label above); Group becomes "Flight or tile"; `Segmented` for Grid / List (values "grid" / "list", icons `grid`, `list`); count "40 of 40 images" in muted; "Select all" as `Button variant="ghost" size="sm"`.
- ImageGrid tile: `rounded-lg overflow-hidden border border-line bg-well transition hover:-translate-y-0.5 hover:shadow-float motion-reduce:hover:translate-y-0`, selected: `ring-2 ring-accent border-accent`, focused: `ring-2 ring-ink/40`; `Checkbox` top-left visible on hover, focus and when selected; status badge top-right (`Pill` sized 10px: Labeled ok, Review warn-strong with dark text, Empty neutral) using `item.labeled`, `item.pending_count`, `item.marked_empty`; caption gradient bottom with file name (12px, white) and box count.
- ImageTable: `text-[13px]`, header `text-xs text-muted font-medium h-9`, rows `h-9 border-b border-line hover:bg-hover`, focus row `ring-2 ring-inset ring-accent/60`, checkbox cell with `Checkbox`.
- SelectionBar: `bg-inverse text-inverse-fg rounded-lg h-11 px-4 animate-reveal`; buttons `Button size="sm"` in inverse styling (pass `className="border-inverse-fg/25 bg-transparent text-inverse-fg hover:bg-inverse-fg/10"`); Clear as ghost.
- Notices: `Alert` (ok for results, warn/danger for failures, info for "Import started"), `data-testid="import-notice"` kept.
- EmptyImages: `EmptyState icon="images"`.
- Dialogs: `Dialog title="Import images"` with `Field`s; advanced settings in `Disclosure label="Advanced settings (the defaults suit most imports)"` (keep this exact label: an e2e test uses it). `AddToDatasetDialog` the same.

- [ ] Steps: update tests (headings, labels), implement file by file running `pnpm test src/data src/screens/DataManagerScreen` after each, `pnpm e2e e2e/data-manager.spec.ts e2e/import.spec.ts e2e/datasets.spec.ts`, commit `feat(images): site office restyle of the Images screen and its dialogs`.

---

### Task 8: Label (editor) screen

**Files:** Modify `frontend/src/screens/EditorScreen.tsx`, `frontend/src/editor/EditorToolbar.tsx`, `ClassSidebar.tsx`, `RegionList.tsx`, `BackLink.tsx`, `ConfidenceFloor.tsx`, `EmptyToggle.tsx`, `EditorCanvas.tsx` (background colour only), and their tests; e2e `editor.spec.ts`, `review.spec.ts` (labels "Proposal" -> "Suggestion", "N proposals" -> "N suggestions").

Rules: layout unchanged (class sidebar 192px left, canvas centre, regions 288px right); sidebar and regions `bg-side border-line`; canvas wrapper `bg-canvas`; toolbar `bg-side border-b border-line h-11 px-3` with `IconButton`s (`arrow-left` Previous, `arrow-right` Next, `fit` Fit, `one-to-one` 1:1, `undo`, `redo`, `keyboard` Keys) each with the hotkey in the tooltip; the accessible names must stay "Previous", "Next", "Fit", "1:1", "Undo", "Redo", "Keyboard shortcuts"; "Accept all (A)" and "Reject all (R)" stay `Button size="sm"` with text; "Show rejected" becomes a `Switch`; "Saved"/"Saving"/"N suggestions" as `Pill`s (the `data-testid`s stay). ClassSidebar: rows `h-8 rounded-md px-2`, swatch `h-2.5 w-2.5 rounded-[3px]`, active `bg-panel border border-accent`, hotkey `Kbd`. RegionList: rows `h-8 px-2 text-[13px]`, hover `bg-hover`, selected `bg-panel`, `Select` sm for the class, `Pill` for the review state (Suggestion warn, Accepted ok, Edited neutral, Rejected neutral line-through), delete as `IconButton icon="trash"` visible on hover and focus, Accept / Reject as `Button size="sm" variant="ghost"`. Konva box colours are unchanged. No enter animations in the editor.

- [ ] Steps: rename in tests first, implement, `pnpm test src/editor src/screens/Editor*`, `pnpm e2e e2e/editor.spec.ts e2e/review.spec.ts`, commit `feat(editor): site office chrome around the canvas`.

---

### Task 9: Review and Datasets screens

**Files:** Modify `frontend/src/screens/ReviewScreen.tsx`, `ReviewScreen.test.tsx`, `ReviewScreenIds.test.tsx`, `frontend/src/screens/DatasetsScreen.tsx`, `DatasetsScreen.test.tsx`, `frontend/src/datasets/DatasetList.tsx`, `DatasetDetail.tsx`, `NewDatasetForm.tsx` and tests; e2e `review.spec.ts`, `datasets.spec.ts`.

Review: title "Review", subtitle "Suggestions from detection runs and pre-annotation wait here until you accept or reject them.", the queue reuses `ImageGrid` styling (already done in Task 7), the back link "Show the whole queue" stays a link, empty state `EmptyState icon="review"` with the existing explanation and links. Datasets: `grid lg:grid-cols-[20rem_1fr] gap-6`; list rows as in Projects with `Pill`s for state; detail with a definition list and a `Button variant="danger"` for delete (the confirm stays); `NewDatasetForm` on `Field`s, split options under `Disclosure label="Split options"`, split advice as `Alert warn`. Button names in tests ("Create dataset", "Delete permanently", "Train on this dataset") are unchanged.

- [ ] Steps as Task 8; commit `feat(review,datasets): site office restyle`.

---

### Task 10: Models, Train, Detect screens

**Files:** Modify `frontend/src/screens/ModelsScreen.tsx`, `TrainScreen.tsx`, `QueryScreen.tsx`, `frontend/src/models/*.tsx`, `frontend/src/train/*.tsx`, `frontend/src/query/*.tsx` and tests; e2e `models.spec.ts`, `train.spec.ts`, `query.spec.ts` (heading "Query" -> "Detect", "Promote" -> "Accept as labels" if the button still says Promote, "New query" -> "New detection").

Models: table as in spec; `StarterModels` as three `rounded-lg border border-line bg-panel p-4` choices in a row with name, one-line description, size, and `Button` "Add to project" (names unchanged); `ImportModelForm` under `Disclosure label="Import weights from a file"` (the e2e uses the button "Import weights": keep that as the submit button's name inside). ModelDetail: definition list, artifacts list with the export `Button`s, `TrainingCurve` unchanged inside a `bg-panel rounded-lg border border-line p-3`.

Train: `TrainForm` on `Field`s, two-column grid for Dataset / Base model / Model name; Epochs, Image size, Batch, Patience, Augmentation, Device under `Disclosure` (default closed; open automatically when a value differs from the default so nothing is hidden by surprise); "Start training" primary with `icon="play"`. `TrainProgress`: `Progress running={active}`, loss and ETA in a muted row with tabular numbers, the log under `Disclosure label="Show log"` (keep the button name the e2e expects if it opens the log by name: read `train.spec.ts` first).

Detect: title "Detect" with the primary "New detection" on the right; `SourcePicker` as `Segmented` (This project's models / Cloud provider) followed by the model or provider `Select`; `ImagePicker` on `Field`s; `TilingFields` under `Disclosure`; `EstimateCard` as a muted row; "Run detection" primary (accessible name "Start" if the e2e uses it: keep the e2e name by keeping the visible text or updating the e2e in the same commit); `RunCard`: `Progress running`, counts, "Review results" primary link-button, "Accept N boxes as labels" secondary with the existing confirmation dialog on `Dialog`, undo as ghost; `RunHistory` as a table.

- [ ] Steps as Task 8 per screen; three commits `feat(models): ...`, `feat(train): ...`, `feat(detect): ...`.

---

### Task 11: Settings screens and the jobs drawer

**Files:** Modify `frontend/src/screens/SettingsScreen.tsx`, `AppSettingsScreen.tsx`, `frontend/src/settings/*.tsx`, `frontend/src/jobs/JobsPanel.tsx`, `JobCard.tsx`, `JobLogView.tsx` and tests; e2e `settings.spec.ts`, `providers.spec.ts`, `jobs.spec.ts`.

Settings: title "Project settings" (App settings stays); sections `section` with a 16px title, a one-line muted description, `divide-y divide-line` between sections; `ClassesSection` rows with a colour swatch `input type="color"` styled as a 24px rounded square, `Input size sm` name, hotkey `Input` 3ch, `IconButton icon="trash"`; `ProvidersSection` rows: provider name, `Pill` key status (ok "Key stored" / neutral "No key"), `Input type="password"`, `Button` Save key, `Button variant="ghost"` Test, `Button variant="danger"` Remove (names as the e2e expects: "Remove Anthropic key"); test result as `Alert`. `SourcesSection`, `ImportDefaultsSection`, `PreannotationSection` on `Field`s.

Jobs drawer: `bg-panel border-l border-line shadow-float w-[28rem]` sliding in with `animate-[reveal_220ms]` (translateX variant: add `slide-in` keyframe to the Tailwind config in this task); rows: `Icon` per type (import, train, detect, datasets), name, `Pill` state (queued neutral, running accent live, succeeded ok, failed danger, cancelled neutral), `Progress`, elapsed, `Button size="sm"` Cancel job / Show log; the log in `JobLogView` as `font-mono text-xs bg-well rounded-md p-3 max-h-64 overflow-auto`.

- [ ] Steps as Task 8; commits `feat(settings): ...`, `feat(jobs): ...`.

---

### Task 12: Sweep, token check, screenshots, drivers, docs

**Files:** any remaining file with old classes; `frontend/scripts/usability_walkthrough.mjs`, `checkpoint3.mjs`, `scripts/acceptance*` driver text selectors; `docs/progress.md`; `docs/evidence/ui/2026-09-19-site-office/*.png`.

- [ ] **Step 1:** `node scripts/check-tokens.mjs` in `frontend/` lists the leftovers; fix each; it must print `tokens ok`. `pnpm lint` (now including the check) green.
- [ ] **Step 2:** `grep -rnE "<(button|input|select|textarea)\b" src --include=*.tsx | grep -v "src/ui/" | grep -v test` returns nothing (allowed exceptions: `input type="color"` in ClassesSection wrapped in a `ui` component; document any other in the commit message).
- [ ] **Step 3:** Full suites: `pnpm test`, `pnpm build`, `pnpm e2e`. Record the counts.
- [ ] **Step 4:** Screenshots on the mock (`scripts/dev.ps1 -Mode mock`), one per screen (projects, home, images grid, images list with a selection, import dialog, label, review, datasets, models, train, detect, project settings, app settings, jobs drawer open, a toast), 1400x900, into `docs/evidence/ui/2026-09-19-site-office/`. Review each against the spec; fix and reshoot what is off.
- [ ] **Step 5:** Update the walk-through driver's text selectors ("Data Manager" -> "Images" etc.), run it against a private copy of the install tree as documented in `docs/progress.md`; all steps pass.
- [ ] **Step 6:** `docs/progress.md`: add the U2 row (branch `ui-site-office`, state, suites, screenshots path) and a log line. Commit `docs: U2 site office UI verified`.
