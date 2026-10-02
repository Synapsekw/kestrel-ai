from app.asset_models.selftest import main


def test_selftest_builds_a_glb(capsys):
    assert main() == 0
    assert capsys.readouterr().out.strip().startswith("asset-models ok ")
