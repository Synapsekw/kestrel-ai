"""Per-provider request pacing for the infer job (spec section 8, Query run job)."""

from __future__ import annotations

import time
from collections.abc import Callable

SECONDS_PER_MINUTE = 60.0


class TokenBucket:
    """A minute's worth of requests up front, refilled continuously.

    The clock and sleep are injectable so the job's pacing can be tested without spending a minute.
    """

    def __init__(
        self,
        requests_per_minute: int,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.capacity = max(1, int(requests_per_minute))
        self.rate = self.capacity / SECONDS_PER_MINUTE  # tokens per second
        self.tokens = float(self.capacity)
        self._monotonic, self._sleep = monotonic, sleep
        self._last = monotonic()

    def _refill(self) -> None:
        now = self._monotonic()
        self.tokens = min(float(self.capacity), self.tokens + (now - self._last) * self.rate)
        self._last = now

    def acquire(self) -> None:
        """Block until one request may be made."""
        self._refill()
        if self.tokens < 1.0:
            self._sleep((1.0 - self.tokens) / self.rate)
            self._refill()
        self.tokens -= 1.0
