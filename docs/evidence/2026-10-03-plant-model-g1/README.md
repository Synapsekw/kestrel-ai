# G1 plant model: Al-Zour acceptance

**Outcome (2026-10-04):** the operator accepted G1. They reviewed the generated Al-Zour plant in the
installed app (main 01f85f14, Site 3D view, project `LNG Terminal - Kestrel plant model`) and judged
it "slightly different from the Cowork model but fine". The scorer's strict targets (spec §13) were
not all met; the operator's acceptance stands in for them.

## Live runs

| Run | Packages | Tokens | Est. cost | Recall | Type match | Within tolerance | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 12/12 | 26.7 M | $117 | 96.3 % | 92.8 % | 85.4 % | Frame fitted through a page placed 26 m off; shore traced from the 1:3000 plan |
| 2 | 11/13 | 25.9 M | $112 | 89.1 % | 86.4 % | 88.2 % | Note-2 frame; 2 packages lost to an APIConnectionError. **Reviewed model** |
| 3 | - | 2.6 M | ~$12 | - | - | - | Survey answer cut off at 16 k output tokens |
| 4 | 18/18 | 37.1 M | $163 | 89.1 % | 80.2 % | 81.8 % | Streaming + retries; no package failures |

- Recall and type figures use range-aware tag matching (score.py `expand_tag`).
- Costs are estimates from list prices, with cached input priced as fresh.
- Each run's `run.json`, `register.csv` and `score.md` are in `run1/` to `run4/`.

## Fixes the runs drove

- The stated site frame wins over a grid fit.
- Shoreline tracing:
  - shorelines are traced from the largest-scale plan;
  - land runs to the revetment toe.
- Error handling:
  - a busy or dropped provider is retried;
  - a failed package is re-run once.
- Model output:
  - Anthropic calls stream with 64 k output tokens;
  - the catalogue listing fits in the tool reply cap.
- Scoring: must-haves use footprint geometry, and tags are matched by notation-independent members.

## Known gaps (not blocking)

- **Granularity:** skid components and single pumps are often modelled as one package item (area 50/70 recall).
- **Run-to-run variance** in package planning.
- **Land outline** worst-point distance of 118-197 m against Cowork's landmask.
- **Asset models default pick** prefers an asset model, so in a project with both kinds the plant is reached from
  the model picker or Maps → "Open site in 3D".
