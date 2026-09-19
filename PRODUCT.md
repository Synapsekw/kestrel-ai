# Machinery Detection

register: product

## Product purpose

A Windows desktop app that takes a construction team from a folder of aerial drone frames to a trained
machinery detector and reviewed counts, without a terminal and without reading documentation. It
replaces Label Studio, ad-hoc scripts and the Ultralytics CLI.

## Users

- Site managers and surveyors who fly the drone and want counts of excavators, trucks and cranes per
  flight. They use Excel, email and a browser all day. They have never trained a model.
- One or two technical people per team who set up providers and compare models. They tolerate detail
  but do not want it in the way.

Both use it at a desk on a Windows laptop or a 24-inch monitor in a bright site office, in sessions of
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

- The current default-Tailwind look: slate grey on slate grey, native form controls, no icons, no motion.
- Label Studio's density and its wall of settings.
- Dashboards that lead with big numbers and gradients.

## Strategic principles

1. The workflow is the navigation. Images, Label, Datasets, Train, Detect, Review, in that order, with
   done, current and locked states visible.
2. One component vocabulary everywhere. A button, a field, a status pill look the same on every screen.
3. Motion only conveys state: press, hover, reveal, running, finished. Nothing decorative, nothing on
   keyboard shortcuts.
4. Advanced settings fold away behind "More options"; the defaults suit most projects.
5. The imagery is the brightest thing on the screen in the editor; the chrome around it stays quiet.
