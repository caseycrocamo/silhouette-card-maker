"""Compare worker and CLI output, including page transforms and old saves."""
import json
from pathlib import Path

import pypdfium2 as pdfium
import pytest
from click.testing import CliRunner
from PIL import Image, ImageDraw

import pdf_worker
import utilities
from offset_pdf import offset_pdf


def pixels(path):
    with pdfium.PdfDocument(path) as document:
        return [page.render(scale=1).to_pil().convert('RGB').tobytes() for page in document]


@pytest.mark.parametrize('angle', [-0.5, 0, 0.5])
def test_worker_matches_cli_and_only_transforms_backs(tmp_path, monkeypatch, angle):
    data = tmp_path / 'data'
    data.mkdir()
    monkeypatch.setattr(utilities, 'DATA_DIR', data)
    # Older files have no angle. Loading must supply zero.
    saved = data / 'offset_data.json'
    saved.write_text(json.dumps({'x_offset': 3, 'y_offset': -2}))
    before_save = saved.read_bytes()
    front = Image.new('RGB', (220, 180), 'white')
    ImageDraw.Draw(front).rectangle((15, 20, 60, 65), fill='navy')
    back = Image.new('RGB', (220, 180), 'white')
    ImageDraw.Draw(back).rectangle((80, 70, 110, 100), fill='red')
    source = tmp_path / 'source-é.pdf'
    front.save(source, save_all=True, append_images=[back], resolution=72, quality=100)
    baseline = tmp_path / 'baseline.pdf'
    base = CliRunner().invoke(offset_pdf, ['--pdf_path', str(source), '--output_pdf_path', str(baseline), '--x_offset', '0', '--y_offset', '0', '--angle', '0', '--ppi', '72'])
    assert base.exit_code == 0, base.output
    expected = tmp_path / 'cli.pdf'
    cli = CliRunner().invoke(offset_pdf, ['--pdf_path', str(source), '--output_pdf_path', str(expected), '--x_offset', '-30', '--y_offset', '0', '--angle', str(angle), '--ppi', '72'])
    assert cli.exit_code == 0, cli.output
    actual = tmp_path / 'worker.pdf'
    result = pdf_worker.dispatch({'command': 'offset_pdf', 'pdf_path': str(source), 'output_pdf_path': str(actual), 'x_offset': -30, 'y_offset': 0, 'angle': angle, 'ppi': 72, 'save': False})
    assert result['ok'], result
    assert pixels(actual) == pixels(expected)
    original, changed = pixels(baseline), pixels(actual)
    assert original[0] == changed[0]
    assert original[1] != changed[1]
    assert saved.read_bytes() == before_save


def test_old_saved_offsets_supply_zero_angle(tmp_path, monkeypatch):
    monkeypatch.setattr(utilities, 'DATA_DIR', tmp_path)
    (tmp_path / 'offset_data.json').write_text('{"x_offset":2,"y_offset":-1}')
    saved = utilities.load_saved_offset()
    assert (saved.x_offset, saved.y_offset, saved.angle_offset) == (2, -1, 0)
