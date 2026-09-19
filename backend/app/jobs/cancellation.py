"""The cancellation signal shared by the job runner, the GPU lock and the trainer.

A leaf module: anything may import it at module scope without pulling in the runner.
"""


class JobCancelled(Exception):
    """Raised inside a job when its cancellation event is set; the runner marks the job cancelled."""


class JobFailure(Exception):
    """Raised by a job with a complete, plain message for the operator; stored as the job's error as is.

    Anything else a job raises is unexpected and is stored with its class name as a clue for support.
    """
