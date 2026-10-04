from app.asset_review.kit_selftest import main


def test_selftest_streams_json_and_vectorises(capsys):
    assert main() == 0
    line = capsys.readouterr().out.strip().splitlines()[-1]
    assert line.startswith("review-import ok ") and line.endswith(" 2 2")
