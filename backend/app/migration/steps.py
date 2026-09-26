"""The migration's data steps (foundation spec §11.4), in order.

Empty until unit MG-steps lands. With no steps the orchestration is **disarmed**
(`app.migration.job.armed()` is False): nothing is submitted, no project is gated, and no project
is marked upgraded before its data has actually been migrated.
"""

from app.migration.pipeline import Step

PIPELINE: tuple[Step, ...] = ()
