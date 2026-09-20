---
type: product-context
status: active
tags: [project/kestrel-ai, product]
---

# Product context

Full source docs: `PRODUCT.md` and `DESIGN.md` at the repo root. This note is the vault's map onto
them. Current project state: [[00-north-star]].

## Purpose

A Windows desktop app that takes a construction team from a folder of aerial drone frames to a
trained machinery detector and reviewed counts, without a terminal and without reading
documentation. It replaces Label Studio, ad-hoc scripts and the Ultralytics CLI.

## Users

- Site managers and surveyors who fly the drone and want counts of excavators, trucks and cranes
  per flight. Daily users of Excel, email and a browser. Have never trained a model.
- One or two technical people per team who set up providers and compare models. Tolerate detail but
  do not want it in the way.

Both work at a desk on a Windows laptop or a 24-inch monitor in a bright site office, in sessions of
twenty minutes to two hours, mostly looking at sand-coloured nadir imagery.

## Success criteria

- A new user labels 50 images with pre-annotations in under 30 minutes without documentation.
- At every moment the user can say where the project stands and what the next step is.
- Nothing on screen needs a machine-learning vocabulary to be understood.

## Tone

Plain, direct, calm. Sentence case. Verbs on buttons ("Import images", "Start training"). Errors say
what happened and what to do. No exclamation marks, no jargon: images not data, label not annotate,
detect not query, suggestions not proposals, accept as labels not promote.

## Anti-references

- The current default-Tailwind look: slate grey on slate grey, native form controls, no icons, no
  motion.
- Label Studio's density and its wall of settings.
- Dashboards that lead with big numbers and gradients.

## Strategic principles

1. The workflow is the navigation. Images, Label, Datasets, Train, Detect, Review, in that order,
   with done, current and locked states visible.
2. One component vocabulary everywhere. A button, a field, a status pill look the same on every
   screen.
3. Motion only conveys state: press, hover, reveal, running, finished. Nothing decorative, nothing
   on keyboard shortcuts.
4. Advanced settings fold away behind "More options"; the defaults suit most projects.
5. The imagery is the brightest thing on the screen in the editor; the chrome around it stays quiet.

## Design language: Site office (`DESIGN.md`)

Light, stone-grey neutrals tinted toward the imagery, one safety-orange accent (`#d9480f`) for the
primary action and the current step, green for done, amber for "needs review". Implemented as CSS
custom properties in `frontend/src/index.css`, exposed as Tailwind colour names in
`frontend/tailwind.config.ts`, used through the components in `frontend/src/ui/`.

- **Colour** — ground/sidebar/panel/well neutrals; ink/muted/dim text; accent orange restrained to
  the primary button, the current step, the focus ring and links; ok (green), warn (amber), danger
  (red) reserved for semantic state, never used as accents.
- **Typography** — one family, Instrument Sans (bundled variable font), fallback "Segoe UI",
  system-ui; tabular numbers in tables/counters; monospace for file names and paths. Scale 12–20px;
  weights 400, 500 (buttons, nav), 600 (titles).
- **Radius, borders, shadow** — `rounded-md` on controls, `rounded-lg` on panels/thumbnails,
  `rounded-full` on pills; 1px borders, no side stripes, no nested cards; shadow only on things that
  float (popovers, drawers, toasts, hovered thumbnails).
- **Spacing and layout** — sidebar 224px, header 48px, screen padding 24px, 16px gap between
  blocks, 8px inside rows; left-aligned, max width 72rem for forms and prose.
- **Components** (`frontend/src/ui/`) — Button, IconButton, Input, Textarea, Select, Checkbox,
  Switch, Field, Pill, Alert, Toast, Progress, Skeleton, EmptyState, Segmented, Kbd, Dialog, Icon,
  Disclosure. Every interactive component has default, hover, focus-visible, active and disabled
  states.
- **Motion** — 140ms hover/press, 180ms reveals, 220ms drawers/dialogs; press is a scale, reveal is
  opacity + translateY; a shimmer on progress bars and a pulsing dot on the running pill are the
  only loops; `prefers-reduced-motion` keeps opacity, removes movement.
- **Copy** — screen names: Projects, Home, Images, Label, Datasets, Train, Detect, Review, Models,
  Project settings, App settings. Suggestions (not proposals), accept as labels (not promote),
  flight (not group).

## Related

- [[00-north-star]]
- [[architecture]]
- [[operations]]
