"""R9-I comments (spec 2026-09-30 reports §7.2 `comments: none | last | all`, §7.3).

Alignment ruling: `image.comments` returns `app.reports.blocks.Comment` (a TypedDict), so tests read
fields by subscript (`c["text"]`) and parse `created_at` back from its ISO 8601 text."""

from datetime import datetime

from reports_image_rows import GENERATED_AT, add_comments, image_finding, make_ctx, row_of

from app.reports.figures import image


def test_none_reads_nothing_and_returns_nothing(handle, crack, make_jpeg):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    add_comments(handle, f.id, 3)
    assert image.comments(make_ctx(handle), row_of(handle, f.id), "none") == []


def test_last_is_the_newest_comment(handle, crack, make_jpeg):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    add_comments(handle, f.id, 3)
    out = image.comments(make_ctx(handle), row_of(handle, f.id), "last")
    assert [(c["author"], c["text"]) for c in out] == [("Dana", "c2")]


def test_all_is_the_thread_oldest_first(handle, crack, make_jpeg):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    add_comments(handle, f.id, 3)
    out = image.comments(make_ctx(handle), row_of(handle, f.id), "all")
    assert [c["text"] for c in out] == ["c0", "c1", "c2"]


def test_all_is_capped_with_a_more_line(handle, crack, make_jpeg):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    add_comments(handle, f.id, 150)
    out = image.comments(make_ctx(handle), row_of(handle, f.id), "all")
    assert len(out) == image.COMMENTS_ALL_MAX + 1
    assert [c["text"] for c in out[:2]] == ["c0", "c1"] and out[99]["text"] == "c99"
    assert out[-1]["author"] == "Kestrel AI"
    assert out[-1]["text"] == "50 more comments are not printed; see the finding in the app."
    assert datetime.fromisoformat(out[-1]["created_at"]) == GENERATED_AT


def test_no_comments_is_an_empty_list_for_every_mode(handle, crack, make_jpeg):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    ctx, row = make_ctx(handle), row_of(handle, f.id)
    assert [image.comments(ctx, row, m) for m in ("none", "last", "all")] == [[], [], []]
