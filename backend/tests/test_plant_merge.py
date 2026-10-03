"""Merge (spec §8.2.3, ruling R9): same tag merges; untagged same-type items overlapping > 60 % merge;
conflicts get straddles_package; ids end unique."""

from app.asset_models.agent.plant.merge import merge_items, norm_tag, with_flag
from app.asset_models.spec import Item, ItemFlag


def it(i, *, tag=None, type="other", e=0.0, n=0.0, size=(10.0, 6.0), conf="medium"):
    return Item.model_validate(
        {
            "id": i,
            "tag": tag,
            "name": i,
            "type": type,
            "footprint": {"kind": "rect", "center": [e, n], "size": list(size), "rot_deg": 0},
            "source": {"kind": "assumed"},
            "confidence": conf,
        }
    )


def test_norm_tag():
    assert norm_tag(" 20-t_0001 ") == "20-T0001" and norm_tag(None) is None and norm_tag("") is None


def test_same_tag_keeps_one_item_and_prefers_confidence_then_newer():
    out = merge_items([[it("a", tag="20-T-0001", conf="high")], [it("b", tag="20-T-0001")]], ["P1", "P2"])
    assert [i.id for i in out] == ["a"]
    out = merge_items([[it("a", tag="20-T-0001")], [it("b", tag="20-t-0001 ")]], ["P1", "P2"])
    assert [i.id for i in out] == ["b"] and out[0].flags == []


def test_same_tag_far_apart_or_other_type_is_flagged():
    out = merge_items([[it("a", tag="T1", e=0)], [it("b", tag="T1", e=30)]], ["P1", "P2"])
    (only,) = out
    flag = only.flags[0]
    assert flag.code == "straddles_package" and flag.value == 30.0 and "P1" in flag.note
    out = merge_items([[it("a", tag="T1")], [it("b", tag="T1", type="composite")]], ["P1", "P2"])
    assert out[0].flags[0].code == "straddles_package"


def test_untagged_overlap_merges_only_same_type_over_sixty_percent():
    a, b = it("a", n=0), it("b", n=2)  # 10 m N x 6 m E boxes shifted 2 m north: overlap 8/10 = 80 %
    assert len(merge_items([[a], [b]])) == 1
    far = it("c", n=7)  # overlap 3/10 = 30 %
    assert len(merge_items([[a], [far]])) == 2
    other_type = it("d", n=2, type="composite")
    assert len(merge_items([[a], [other_type]])) == 2


def test_ids_end_unique():
    out = merge_items([[it("x", tag="T1")], [it("x", tag="T2", e=100)]])
    assert sorted(i.id for i in out) == ["x", "x-2"]


def test_with_flag_replaces_the_same_code():
    a = with_flag(it("a"), ItemFlag(code="builder_fallback", note="one"))
    a = with_flag(a, ItemFlag(code="builder_fallback", note="two"))
    assert [(f.code, f.note) for f in a.flags] == [("builder_fallback", "two")]


def test_many_untagged_items_merge_quickly():
    import time

    items = [it(f"u{k}", e=(k % 50) * 20.0, n=(k // 50) * 20.0) for k in range(2000)]
    t0 = time.monotonic()
    out = merge_items([items, items])
    assert len(out) == 2000 and time.monotonic() - t0 < 10
