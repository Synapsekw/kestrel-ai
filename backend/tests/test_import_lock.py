"""Import jobs for one project run one at a time: a second import waits for the first and the
wait is cancellable (two imports of the same site collided on the dedupe snapshot)."""

import threading
import time

import pytest

from app.datasets.importer import hold_import_lock
from app.jobs.cancellation import JobCancelled


def test_second_holder_waits_for_the_first():
    order: list[str] = []
    entered = threading.Event()
    release = threading.Event()

    def first():
        with hold_import_lock("p1", threading.Event()):
            order.append("first-in")
            entered.set()
            release.wait(5)
            order.append("first-out")

    def second():
        entered.wait(5)
        with hold_import_lock("p1", threading.Event()):
            order.append("second-in")

    t1, t2 = threading.Thread(target=first), threading.Thread(target=second)
    t1.start()
    t2.start()
    entered.wait(5)
    time.sleep(0.3)
    assert order == ["first-in"]  # the second import is still waiting
    release.set()
    t1.join(5)
    t2.join(5)
    assert order == ["first-in", "first-out", "second-in"]


def test_other_projects_do_not_wait():
    with hold_import_lock("p1", threading.Event()):
        with hold_import_lock("p2", threading.Event()):
            pass


def test_waiting_import_can_be_cancelled():
    cancelled = threading.Event()
    with hold_import_lock("p3", threading.Event()):
        cancelled.set()
        with pytest.raises(JobCancelled):
            with hold_import_lock("p3", cancelled):
                pass
