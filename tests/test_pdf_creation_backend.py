"""Regression coverage for the PDF worker's metadata and preflight contract."""
from pathlib import Path

from click.testing import CliRunner
from PIL import Image, ImageDraw

from create_pdf import cli
from pdf_worker import dispatch


def _source_dirs(tmp_path):
    front, back, double = (tmp_path / name for name in ("front", "back", "double"))
    for directory in (front, back, double):
        directory.mkdir()
    Image.new("RGB", (63, 88), "navy").save(front / "card.png")
    return front, back, double


def test_preflight_reports_all_unique_skips_and_out_of_range_slots(tmp_path):
    front, back, double = _source_dirs(tmp_path)
    argv = ["--front_dir_path", str(front), "--back_dir_path", str(back),
            "--double_sided_dir_path", str(double), "--only_fronts"]
    for slot in (0, 0, 1, 2, 3, 4, 5, 6, 7):
        argv += ["--skip", str(slot)]
    response = dispatch({"command": "preflight_create_pdf", "argv": argv})["result"]
    assert response["slot_capacity"] == 8
    assert "skip" in response["errors"]
    assert not list(tmp_path.rglob(".*"))


def test_preflight_reports_orphaned_double_sided_images_without_mutation(tmp_path):
    front, back, double = _source_dirs(tmp_path)
    Image.new("RGB", (63, 88), "red").save(double / "orphan.png")
    before = (double / "orphan.png").read_bytes()
    response = dispatch({"command": "preflight_create_pdf", "argv": [
        "--front_dir_path", str(front), "--back_dir_path", str(back),
        "--double_sided_dir_path", str(double),
    ]})["result"]
    assert "double_sided_dir_path" in response["errors"]
    assert (double / "orphan.png").read_bytes() == before


def test_preflight_reports_empty_fronts_and_invalid_extension(tmp_path):
    front, back, double = _source_dirs(tmp_path)
    (front / "card.png").unlink()
    result = dispatch({"command": "preflight_create_pdf", "argv": [
        "--front_dir_path", str(front), "--back_dir_path", str(back),
        "--double_sided_dir_path", str(double), "--output_path", str(tmp_path / "out.txt"),
    ]})["result"]
    assert "front_dir_path" in result["errors"]
    assert "output_path" in result["errors"]


def test_png_output_preserves_dotted_folder_and_legacy_pdf_destination(tmp_path):
    front, back, double = _source_dirs(tmp_path)
    dotted = tmp_path / "pages.v2"
    result = CliRunner().invoke(cli, [
        "--front_dir_path", str(front), "--back_dir_path", str(back),
        "--double_sided_dir_path", str(double), "--only_fronts", "--output_images",
        "--output_path", str(dotted),
    ])
    assert result.exit_code == 0, result.output
    assert (dotted / "page1.png").is_file()
    assert str(dotted) in result.output
    legacy = CliRunner().invoke(cli, [
        "--front_dir_path", str(front), "--back_dir_path", str(back),
        "--double_sided_dir_path", str(double), "--only_fronts", "--output_images",
        "--output_path", str(tmp_path / "legacy.pdf"),
    ])
    assert legacy.exit_code == 0, legacy.output
    assert (tmp_path / "page1.png").is_file()


def test_generic_back_and_paired_reverse_adjustments_change_rendered_pages(tmp_path):
    front, back, double = _source_dirs(tmp_path)
    # Use varied artwork so crop and fit choices produce visible pixel changes.
    def striped(size, colors):
        image = Image.new("RGB", size, colors[0])
        draw = ImageDraw.Draw(image)
        for x in range(0, size[0], 30):
            draw.rectangle((x, 0, x + 14, size[1]), fill=colors[(x // 30) % len(colors)])
        return image
    striped((480, 880), ("blue", "yellow", "cyan")).save(front / "card.png")
    striped((480, 880), ("green", "white", "black")).save(front / "single.png")
    striped((260, 880), ("orange", "white", "black")).save(double / "card.png")
    striped((880, 480), ("purple", "pink", "black")).save(back / "back.png")

    def render(label, options=()):
        destination = tmp_path / label
        args = ["--front_dir_path", str(front), "--back_dir_path", str(back),
                "--double_sided_dir_path", str(double), "--output_images", "--output_path", str(destination)]
        result = CliRunner().invoke(cli, args + list(options))
        assert result.exit_code == 0, result.output
        return [Image.open(destination / f"page{i}.png").convert("RGB") for i in (1, 2)]

    baseline = render("baseline")
    generic_crop = render("generic_crop", ["--fit_backs", "crop"])
    paired_crop = render("paired_crop", ["--crop", "8"])
    backs_crop = render("backs_crop", ["--crop_backs", "8"])
    edge_back = render("edge_back", ["--extend_edges_backs", "12"])
    corner_back = render("corner_back", ["--extend_corners_backs", "12"])
    assert baseline[1].tobytes() != generic_crop[1].tobytes()
    assert baseline[0].tobytes() != paired_crop[0].tobytes()
    assert baseline[1].tobytes() != backs_crop[1].tobytes()
    assert baseline[1].tobytes() != edge_back[1].tobytes()
    assert baseline[1].tobytes() != corner_back[1].tobytes()


def test_gui_groups_cover_the_actual_click_creation_contract():
    import json
    import shutil
    import subprocess
    import pytest
    from create_pdf import pdf_capabilities
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required to compare the GUI and Click contracts')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '-e', "process.stdout.write(JSON.stringify(Object.values(require('./GUI/shared/pdfCreationSettings').GROUPS).flat()))"], cwd=root, check=True, capture_output=True, text=True)
    gui_options = json.loads(result.stdout)
    assert len(gui_options) == len(set(gui_options))
    assert set(gui_options) == {option['name'] for option in pdf_capabilities()['options']}


def test_specialty_layout_preflight_and_generation_agree(tmp_path):
    from create_pdf import pdf_capabilities
    front, back, double = _source_dirs(tmp_path)
    source_args = ['--front_dir_path', str(front), '--back_dir_path', str(back), '--double_sided_dir_path', str(double), '--only_fronts']
    for specialty in pdf_capabilities()['specialty_layouts']:
        args = source_args + ['--specialty', specialty['name']]
        preflight = dispatch({'command': 'preflight_create_pdf', 'argv': args})['result']
        assert not preflight['errors'], preflight
        assert preflight['slot_capacity'] > 0
        result = dispatch({'command': 'create_pdf', 'argv': args + ['--output_images', '--ppi', '72', '--output_path', str(tmp_path / specialty['name'])]})
        assert result['ok'], result
        with Image.open(result['result']['files'][0]) as page:
            assert page.width > 0 and page.height > 0


def test_duplicate_skips_produce_the_same_page_as_unique_skips(tmp_path):
    front, back, double = _source_dirs(tmp_path)
    source_args = ['--front_dir_path', str(front), '--back_dir_path', str(back), '--double_sided_dir_path', str(double), '--only_fronts', '--output_images', '--ppi', '72']
    outputs = []
    for label, skips in [('unique', ['--skip', '0']), ('duplicate', ['--skip', '0', '--skip', '0'])]:
        result = dispatch({'command': 'create_pdf', 'argv': source_args + skips + ['--output_path', str(tmp_path / label)]})
        assert result['ok'], result
        with Image.open(result['result']['files'][0]) as page:
            outputs.append(page.tobytes())
    assert outputs[0] == outputs[1]


def test_preflight_reports_missing_saved_offset_without_changing_files(tmp_path, monkeypatch):
    import utilities
    monkeypatch.setattr(utilities, 'DATA_DIR', tmp_path / 'missing-data')
    front, back, double = _source_dirs(tmp_path)
    args = ['--front_dir_path', str(front), '--back_dir_path', str(back), '--double_sided_dir_path', str(double), '--only_fronts', '--load_offset']
    result = dispatch({'command': 'preflight_create_pdf', 'argv': args})['result']
    assert not result['errors']
    assert any('No saved printer offset' in warning for warning in result['warnings'])
    assert not (tmp_path / 'missing-data').exists()


def test_preflight_returns_geometry_for_the_settings_preview(tmp_path):
    front, back, double = _source_dirs(tmp_path)
    args = ['--front_dir_path', str(front), '--back_dir_path', str(back), '--double_sided_dir_path', str(double), '--only_fronts']
    result = dispatch({'command': 'preflight_create_pdf', 'argv': args})['result']
    geometry = result['preview']
    assert geometry['width'] > 0 and geometry['height'] > 0
    assert len(geometry['x']) * len(geometry['y']) == result['slot_capacity']
    assert all(0 <= x < geometry['width'] for x in geometry['x'])
    assert all(0 <= y < geometry['height'] for y in geometry['y'])
    assert max(geometry['x']) + geometry['card_width'] <= geometry['width']
    assert max(geometry['y']) + geometry['card_height'] <= geometry['height']


def test_bundled_gui_catalog_matches_the_current_engine():
    import json
    from scripts.export_pdf_catalog import build_catalog
    root = Path(__file__).resolve().parents[1]
    assert json.loads((root / 'GUI/shared/pdfCatalog.json').read_text()) == build_catalog()
