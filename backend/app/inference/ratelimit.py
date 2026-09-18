"""Per-provider request pacing for the infer job (spec section 8, Query run job)."""

from __future__ import annotations

import threading
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
        self._lock = threading.Lock()

    def set_rate(self, requests_per_minute: int) -> None:
        """Follow a settings change. Tokens already earned are kept, up to the new capacity."""
        capacity = max(1, int(requests_per_minute))
        if capacity == self.capacity:
            return
        self._refill()
        self.capacity = capacity
        self.rate = capacity / SECONDS_PER_MINUTE
        self.tokens = min(self.tokens, float(capacity))

    def _refill(self) -> None:
        now = self._monotonic()
        self.tokens = min(float(self.capacity), self.tokens + (now - self._last) * self.rate)
        self._last = now

    def acquire(self) -> None:
        """Block until one request may be made. Safe to call from several job threads."""
        with self._lock:
            self._refill()
            if self.tokens < 1.0:
                self._sleep((1.0 - self.tokens) / self.rate)
                self._refill()
            self.tokens -= 1.0


_BUCKETS: dict[str, TokenBucket] = {}
_BUCKETS_LOCK = threading.Lock()


def bucket_for(provider: str, requests_per_minute: int) -> TokenBucket:
    """The one bucket for this provider, at the currently configured rate.

    The limit belongs to the provider account, not to a job: two runs against Anthropic at once
    have to share one minute's worth of requests, or the second one collects 429s. The rate is
    refreshed on every call so an edit in settings takes effect without a restart.
    """
    with _BUCKETS_LOCK:
        bucket = _BUCKETS.get(provider)
        if bucket is None:
            bucket = _BUCKETS[provider] = TokenBucket(requests_per_minute)
        else:
            bucket.set_rate(requests_per_minute)
        return bucket


def reset_buckets() -> None:
    """Drop every bucket. For tests: process state must not leak from one test into the next."""
    with _BUCKETS_LOCK:
        _BUCKETS.clear()
