"""Cross-worker checks for user layouts and calibration in a running app."""
import json
from pathlib import Path
from unittest.mock import patch

from PIL import Image
import pypdfium2 as pdfium

import pdf_worker
import template_worker


def test_custom_template_is_available_to_running_pdf_worker(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    definitions = tmp_path / 'custom-layouts.json'
    definitions.write_text('{}')
    with patch.dict('os.environ', {'SCM_EXTRA_LAYOUTS': str(definitions), 'SCM_CUSTOM_LAYOUT_PATH': str(definitions)}):
        # Prime the PDF worker before the definition exists.
        assert pdf_worker.dispatch({'command': 'pdf_capabilities'})['ok']
        generated = template_worker.handle({
            'command': 'single', 'card_width': '60mm', 'card_height': '85mm',
            'card_name': 'gui_test_card', 'paper_width': '8.5in', 'paper_height': '11in',
            'paper_name': 'gui_test_paper', 'orientation': 'portrait', 'save': True,
            'output_path': str(tmp_path / 'new.dxf'),
        })
        assert generated['ok'], generated
        catalog = pdf_worker.dispatch({'command': 'pdf_capabilities'})['result']
        choices = {option['name']: option['choices'] for option in catalog['options']}
        assert 'gui_test_card' in choices['card_size']
        assert 'gui_test_paper' in choices['paper_size']
        front = tmp_path / 'front'
        front.mkdir()
        back = tmp_path / 'back'
        back.mkdir()
        doubles = tmp_path / 'double_sided'
        doubles.mkdir()
        Image.new('RGB', (60, 85), 'navy').save(front / 'card.png')
        output = tmp_path / 'cards.pdf'
        result = pdf_worker.dispatch({'command': 'create_pdf', 'argv': [
            '--front_dir_path', str(front), '--back_dir_path', str(back),
            '--double_sided_dir_path', str(doubles), '--card_size', 'gui_test_card',
            '--paper_size', 'gui_test_paper', '--only_fronts', '--ppi', '72',
            '--output_path', str(output),
        ]})
        assert result['ok'], result
        assert output.exists()
        calibration = pdf_worker.dispatch({'command': 'generate_calibration',
            'paper_sizes': ['gui_test_paper'], 'output_dir': str(tmp_path / 'calibration'), 'ppi': 72})
        assert calibration['ok'], calibration
        with pdfium.PdfDocument(calibration['result']['paths'][0]) as document:
            assert len(document) == 2
            assert all(abs(a - b) < 1 for a, b in zip(sorted(document[0].get_size()), (612, 792)))
    # Keep subsequent in-process tests independent of these temporary choices.
    pdf_worker.refresh_creation_choices()


def test_bundled_plugin_metadata_matches_real_format_enums():
    import importlib
    from plugins.gui_imports import GAMES, capabilities
    for game in capabilities()['games']:
        module = GAMES[game['id']][2].rsplit('.', 1)[0] + '.deck_formats'
        formats = importlib.import_module(module).DeckFormat
        assert {item['id'] for item in game['formats']} == {item.value for item in formats}, game['id']


def test_card_worker_uses_utf8_even_with_a_legacy_console(tmp_path):
    import os
    import subprocess
    import sys
    request = {'version': 1, 'id': 1, 'op': 'parse', 'text': '1 Pikaé SVI 047'}
    process = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'card_worker.py')],
        input=json.dumps(request, ensure_ascii=False) + '\n', text=True, encoding='utf-8',
        capture_output=True, env=dict(os.environ, PYTHONIOENCODING='cp1252', CARD_MAKER_CACHE_DIR=str(tmp_path)),
        timeout=30, check=True)
    response = json.loads(process.stdout.splitlines()[1])
    assert response['result']['entries'][0]['name'] == 'Pikaé'


def test_import_pairs_front_and_back_with_different_file_extensions(tmp_path):
    from types import SimpleNamespace
    from plugins.gui_imports import GameImporter

    def factory(front_dir, back_dir):
        def fetch(index, code, quantity):
            Image.new('RGB', (8, 8), 'red').save(Path(front_dir) / 'same.jpg')
            Image.new('RGB', (8, 8), 'blue').save(Path(back_dir) / 'same.png')
        return fetch

    parser = SimpleNamespace(DeckFormat=lambda value: value,
        parse_deck=lambda value, fmt, handle: handle(1, 'card-code', 2))
    api = SimpleNamespace(get_handle_card=factory)
    with patch('plugins.gui_imports.importlib.import_module', side_effect=lambda name:
            parser if name.endswith('deck_formats') else api):
        result = GameImporter(tmp_path).import_game({'game': 'arkham_horror_lcg',
            'format': 'arkhamdb_json', 'input': {'kind': 'text', 'value': '{}'}})
    assert result['status'] == 'success'
    assert result['entries'][0]['qty'] == 2
    assert result['entries'][0]['back']['cacheId']
