---
type: adr
date: 2026-10-02
status: accepted
tags: [decision, gotcha, pointclouds, memory]
related: ["[[2026-09-23-point-clouds-design]]"]
---

# PotreeConverter's RAM plateaus; the point-cloud admission was a straight line through two points

## Context

The import admitted PotreeConverter at 45 MB per million points + 1 GiB, a line through the spike's
two clouds (21.7 M at 1.2 GB, 195 M at 8.7 GB). The LNG Terminal cloud (`Production_2-Final.laz`,
842 M points, 3.9 GB LAZ) was refused at "about 39.0 GB of free memory; 36.0 GB is free", after
the copy and scan, on a 64 GB machine with a concurrent ortho import.

Measured the same day, PotreeConverter 2.1.5 `--encoding BROTLI` straight on that file (24 logical
CPUs): exit 0 in 132 s, **peak 10.3 GB private / 9.9 GB RSS**, octree 4.4 GB. Counting held at
~1.1 GB, distributing peaked at 2.8 GB, indexing climbed to the peak. Memory grows with the chunk
size until chunks reach their cap, then almost stops: +1.6 GB for 4.3x the points.

## Decision

`ram_needed` = min(45 MB/Mpt, 9 GB + 2.5 MB/Mpt) + 1 GiB. Below ~212 M points nothing changes (the
195 M figure stays 9.9 GB); 842 M now needs 12.2 GB against the measured 10.3 GB.

## Consequences

- The plateau depends on the converter's thread count (one per logical CPU). A machine with many
  more cores could peak higher; re-measure before trusting the curve on new hardware.
- Nothing above 842 M has been measured. The 2.5 MB/Mpt tail is the measured slope rounded up.
- Thinning the display copy and tiling are not needed for clouds of this size. The octree is
  display-only (surfaces, profiles and export read the source), so thinning remains the cheap
  lever if a much larger cloud ever outgrows the plateau.
