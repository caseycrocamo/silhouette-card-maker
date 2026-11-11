import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _worker(tmp_path, requests, overrides=None):
    override_path = tmp_path / "layout-overrides.json"
    if not override_path.exists():
        override_path.write_text(json.dumps(overrides or {}))
    env = dict(os.environ, SCM_EXTRA_LAYOUTS=str(tmp_path / "custom-layouts.json"),
               SCM_CUTTING_TEMPLATES_DIR=str(tmp_path / "templates"),
               SCM_LAYOUT_OVERRIDES=str(override_path))
    proc = subprocess.run([sys.executable, str(ROOT / "template_worker.py")],
                          input="".join(json.dumps(x) + "\n" for x in requests),
                          text=True, capture_output=True, env=env, check=True)
    return [json.loads(line) for line in proc.stdout.splitlines()]


def test_single_custom_layout_saves_and_reloads(tmp_path):
    output = tmp_path / "出力" / "custom.dxf"
    first = _worker(tmp_path, [
        {"command": "single", "card_width": "63mm", "card_height": "88mm",
         "card_radius": "4mm", "card_name": "my_card", "paper_width": "8.5in",
         "paper_height": "11in", "paper_name": "my_paper", "variant": "default",
         "orientation": "portrait", "save": True, "output_path": str(output)},
        {"command": "list"},
    ])
    assert first[0] == {"ready": True}
    assert first[1]["ok"] and first[1]["rows"] and first[1]["capacity"]
    assert output.exists()
    saved = json.loads((tmp_path / "custom-layouts.json").read_text())
    assert saved["card_sizes"]["my_card"]["radius"] == "4mm"
    assert saved["layouts"]["my_paper"]["my_card"]["default"]["orientation"] == "portrait"
    catalog = first[2]
    assert any(x["name"] == "my_card" for x in catalog["card_sizes"])
    assert any(x["name"] == "my_paper" for x in catalog["paper_sizes"])


def test_worker_returns_validation_errors_without_writing(tmp_path):
    output = tmp_path / "bad.dxf"
    messages = _worker(tmp_path, [{"command": "single", "card_width": "999in",
                                   "card_height": "999in", "paper_size": "letter",
                                   "output_path": str(output)}])
    assert messages[1]["ok"] is False
    assert not output.exists()


def test_batch_all_and_missing_have_distinct_candidate_results(tmp_path):
    out = tmp_path / "batch"
    all_result = _worker(tmp_path, [{"command": "batch_manifest", "mode": "all", "output_dir": str(out)}])[1]
    first = next(item for item in all_result["items"] if not item.get("skipped"))
    destination = Path(first["path"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("fixture")
    missing_result = _worker(tmp_path, [{"command": "batch_manifest", "mode": "missing", "output_dir": str(out)}])[1]
    skipped = next(item for item in missing_result["items"] if item.get("path") == str(destination))
    assert skipped["skipped"] is True
    assert len(all_result["items"]) == len(missing_result["items"])
    assert first["output_path"] == first["path"]


def test_batch_manifest_single_jobs_write_to_each_manifest_path(tmp_path):
    out = tmp_path / "batch output"
    manifest = _worker(tmp_path, [{"command": "batch_manifest", "mode": "all", "output_dir": str(out)}])[1]
    selected = [item for item in manifest["items"] if not item.get("skipped")][:2]
    assert len(selected) == 2
    results = _worker(tmp_path, [{"command": "single", **item} for item in selected])[1:]
    assert all(result["ok"] for result in results)
    assert [Path(result["path"]) for result in results] == [Path(item["path"]) for item in selected]
    assert all(Path(item["path"]).exists() for item in selected)


def test_optimize_manifest_includes_missing_combinations(tmp_path):
    result = _worker(tmp_path, [{"command": "list"},
                                {"command": "batch_manifest", "mode": "optimize",
                                 "output_dir": str(tmp_path / "optimized")}])
    defined = {(x["paper_size"], x["card_size"], v["name"])
               for x in result[1]["layouts"] for v in x["variants"]}
    candidates = result[2]["items"]
    candidate_keys = {(x["paper_size"], x["card_size"], x["variant"]) for x in candidates}
    assert defined < candidate_keys
    generated = [item for item in candidates if not item.get("skipped")]
    assert all(item["orientation"] in {"landscape", "portrait"} and item["optimize_layout"] and
               item["output_path"] == item["path"]
               for item in generated)


def test_optimized_geometry_and_version_reload_from_override(tmp_path):
    bad_layout = {"orientation": "portrait", "version": 1, "num_rows": 1,
                  "num_cols": 1, "registration": {"length": "5mm"}}
    overrides = {"layouts": {"letter": {"poker": {"default": bad_layout}}}}
    results = _worker(tmp_path, [
        {"command": "batch_manifest", "mode": "optimize", "output_dir": str(tmp_path / "optimized")},
        {"command": "list"},
    ], overrides=overrides)
    assert results[0] == {"ready": True}
    candidate = next(x for x in results[1]["items"] if x.get("card_size") == "poker" and
                     x.get("paper_size") == "letter" and x.get("variant") == "default")
    assert candidate["version"] == 2
    generated = _worker(tmp_path, [
        {"command": "single", **candidate}, {"command": "list"}
    ], overrides=overrides)
    assert generated[1]["ok"]
    assert generated[1]["orientation"] == candidate["orientation"]
    assert generated[1]["version"] == 2
    layout = next(x for x in generated[2]["layouts"]
                  if x["paper_size"] == "letter" and x["card_size"] == "poker")["variants"][0]
    assert layout["orientation"] == generated[1]["orientation"]
    assert layout["rows"] == generated[1]["rows"]
    assert layout["cols"] == generated[1]["cols"]
    assert layout["version"] == generated[1]["version"]


def test_gui_matches_cli_geometry_for_variants_orientations_and_aliases(tmp_path, monkeypatch):
    import hashlib
    from click.testing import CliRunner
    import generate_dxf
    import template_worker
    bundled = ROOT / 'assets' / 'layouts.json'
    original = hashlib.sha256(bundled.read_bytes()).hexdigest()
    monkeypatch.setenv('SCM_EXTRA_LAYOUTS', str(tmp_path / 'custom-layouts.json'))
    monkeypatch.setenv('SCM_LAYOUT_OVERRIDES', str(tmp_path / 'overrides.json'))
    (tmp_path / 'custom-layouts.json').write_text('{}')
    (tmp_path / 'overrides.json').write_text('{}')
    for variant in ['default', 'borderless']:
        for orientation in ['portrait', 'landscape', 'optimize']:
            suffix = f'{variant}-{orientation}'
            cli = CliRunner().invoke(generate_dxf.cli, [
                'single', str(tmp_path / f'cli-{suffix}.dxf'), '--card_size', 'standard',
                '--paper_size', 'LETTER', '--variant', variant, '--orientation', orientation,
                '--card_radius', '0.1in',
            ], standalone_mode=False)
            assert cli.exception is None, cli.output
            result = template_worker.handle({'command': 'single', 'card_size': 'standard',
                'paper_size': 'LETTER', 'variant': variant, 'orientation': orientation,
                'card_radius': '0.1in', 'output_path': str(tmp_path / f'gui-{suffix}.dxf')})
            assert result['ok'], result
            for key in ['rows', 'cols', 'capacity', 'orientation', 'max_length_mm']:
                assert result[key] == cli.return_value[key]
    assert hashlib.sha256(bundled.read_bytes()).hexdigest() == original


def test_borderless_rejects_paper_larger_than_mat_without_writing(tmp_path):
    destination = tmp_path / 'oversize.dxf'
    result = _worker(tmp_path, [{'command': 'single', 'card_size': 'poker',
        'paper_width': '25in', 'paper_height': '13in', 'variant': 'borderless',
        'output_path': str(destination)}])[1]
    assert result['ok'] is False
    assert not destination.exists()
