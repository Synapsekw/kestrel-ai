"""PDFium is not thread-safe: open_pdf holds one process-wide lock for the whole context (task 10b)."""

import threading
import time

from drawings_helpers import write_pdf

from app.drawings import pdf


def test_open_pdf_never_overlaps_across_threads(tmp_path):
    src = write_pdf(tmp_path / "a.pdf", [(200.0, 200.0)])
    state = {"inside": 0, "max": 0}
    guard = threading.Lock()
    barrier = threading.Barrier(3)

    def work():
        barrier.wait()
        with pdf.open_pdf(src) as doc:
            with guard:
                state["inside"] += 1
                state["max"] = max(state["max"], state["inside"])
            time.sleep(0.05)
            assert len(doc) == 1
            with guard:
                state["inside"] -= 1

    threads = [threading.Thread(target=work) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert state["max"] == 1 and state["inside"] == 0


def test_lock_is_reentrant_and_released_on_error(tmp_path):
    src = write_pdf(tmp_path / "a.pdf", [(200.0, 200.0)])
    with pdf.open_pdf(src), pdf.open_pdf(src):  # nested in one thread must not deadlock
        pass
    try:
        with pdf.open_pdf(src):
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    done = []

    def again():
        with pdf.open_pdf(src):
            done.append(1)

    t = threading.Thread(target=again)  # a leaked lock would hang here
    t.start()
    t.join(5)
    assert done == [1]


def _hold_lock_elsewhere():
    """Hold the PDFium lock from another thread (as an import's render would); returns release()."""
    held, release = threading.Event(), threading.Event()

    def hold():
        with pdf._PDFIUM_LOCK:
            held.set()
            release.wait(10)

    t = threading.Thread(target=hold, daemon=True)
    t.start()
    assert held.wait(5)

    def done():
        release.set()
        t.join(5)

    return done


def test_open_pdf_with_wait_s_raises_pdf_busy_when_the_lock_is_held(tmp_path):
    src = write_pdf(tmp_path / "a.pdf", [(200.0, 200.0)])
    release = _hold_lock_elsewhere()
    try:
        t0 = time.monotonic()
        try:
            with pdf.open_pdf(src, wait_s=0.2):
                raise AssertionError("opened while another thread held the lock")
        except pdf.PdfBusy:
            pass
        assert time.monotonic() - t0 < 2
    finally:
        release()
    with pdf.open_pdf(src, wait_s=0.2) as doc:  # free again: opens, and releases after
        assert len(doc) == 1
    assert pdf._PDFIUM_LOCK.acquire(blocking=False)
    pdf._PDFIUM_LOCK.release()
