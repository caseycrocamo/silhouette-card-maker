"""Opt-in native parity acceptance without the project Python on child PATH.

Run after staging native helpers:
CARD_MAKER_PARITY_BIN_DIR=/absolute/path/to/bin python -m pytest tests/test_frozen_gui_parity.py -q
"""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import queue
import subprocess
import threading

from PIL import Image
import pypdfium2 as pdfium
import pytest

BIN_DIR = os.environ.get('CARD_MAKER_PARITY_BIN_DIR')
pytestmark = pytest.mark.skipif(not BIN_DIR, reason='Set CARD_MAKER_PARITY_BIN_DIR to run frozen helpers')
TIMEOUT = 180  # Allow macOS first-launch signature validation.


@pytest.fixture
def native(tmp_path):
    binaries = Path(BIN_DIR).resolve()
    native_path = str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32') if os.name == 'nt' else '/usr/bin:/bin'
    env = dict(os.environ, PATH=native_path, PYTHONIOENCODING='utf-8')
    for variable in ('PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV'):
        env.pop(variable, None)
    for name in ('front', 'back', 'double_sided', 'output', 'data', 'decklist'):
        directory = tmp_path / name
        directory.mkdir()
        env[f'CARD_MAKER_{name.upper()}_DIR'] = str(directory)
    cache = tmp_path / 'card-cache'
    cache.mkdir()
    definitions = tmp_path / 'custom-layouts.json'
    definitions.write_text('{}', encoding='utf-8')
    env.update(CARD_MAKER_CACHE_DIR=str(cache), SCM_EXTRA_LAYOUTS=str(definitions),
               SCM_CUSTOM_LAYOUT_PATH=str(definitions),
               SCM_CUTTING_TEMPLATES_DIR=str(tmp_path / 'templates'))

    def executable(name):
        result = binaries / (name + ('.exe' if os.name == 'nt' else ''))
        assert result.is_file(), f'Native helper missing: {result}'
        return str(result)

    return tmp_path, env, executable


@contextmanager
def worker(executable, directory, env):
    """Keep cache files alive until the caller has inspected returned images."""
    child = subprocess.Popen([executable], cwd=directory, env=env, stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, encoding='utf-8')
    output = queue.Queue()
    diagnostics = []

    def read_stdout():
        for line in child.stdout:
            output.put(line)
        output.put(None)

    def read_stderr():
        for line in child.stderr:
            diagnostics.append(line)

    readers = [threading.Thread(target=read_stdout, daemon=True),
               threading.Thread(target=read_stderr, daemon=True)]
    for reader in readers:
        reader.start()

    def response():
        try:
            line = output.get(timeout=TIMEOUT)
        except queue.Empty:
            pytest.fail(f'Frozen worker timed out: {executable}\n{"".join(diagnostics)}')
        assert line is not None, f'Frozen worker exited: {executable}\n{"".join(diagnostics)}'
        return json.loads(line)

    try:
        assert response().get('ready') is True

        def request(payload):
            child.stdin.write(json.dumps(payload, ensure_ascii=False) + '\n')
            child.stdin.flush()
            result = response()
            assert not result.get('error'), result
            assert result.get('ok', True), result
            return result

        yield request
    finally:
        child.stdin.close()
        try:
            child.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=10)
        for reader in readers:
            reader.join(timeout=2)
        child.stdout.close()
        child.stderr.close()
    assert child.returncode == 0, ''.join(diagnostics)


@contextmanager
def image_server():
    images = {}
    for name, color in (('front.jpg', 'red'), ('back.png', 'blue')):
        data = io.BytesIO()
        Image.new('RGB', (24, 32), color).save(data, 'JPEG' if name.endswith('.jpg') else 'PNG')
        images['/' + name] = data.getvalue()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            data = images.get(self.path)
            if data is None:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg' if self.path.endswith('.jpg') else 'image/png')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_frozen_mtg_json_csv_custom_images_and_pairs(native):
    directory, env, executable = native
    with image_server() as url, worker(executable('card_worker'), directory, env) as request:
        source = directory / 'déck-原稿.json'
        source.write_text(json.dumps({'entries': {'main': [{'count': 3, 'card_digest': {
            'name': 'Custom Éowyn', 'set': 'ltr', 'collector_number': '001',
            'image_uris': {'front': url + '/front.jpg', 'back': url + '/back.png'},
        }}]}}), encoding='utf-8')
        original = source.read_bytes()
        imported = request({'version': 1, 'id': 1, 'op': 'import', 'game': 'mtg',
                            'format': 'scryfall_json', 'input': {'kind': 'file', 'value': str(source)}})['result']
        assert imported['status'] == 'success'
        assert len(imported['entries']) == 1
        entry = imported['entries'][0]
        assert (entry['name'], entry['qty']) == ('Custom Éowyn', 3)
        printing = entry['printing']
        assert printing['custom'] and printing['paired'] and 'rawCard' not in printing
        assert len(printing['faces']) == 2
        for face, expected in zip(printing['faces'], ((254, 0, 0), (0, 0, 255))):
            image_path = directory / 'card-cache' / (face['cacheId'] + '.png')
            assert image_path.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
            with Image.open(image_path) as image:
                pixel = image.convert('RGB').getpixel((0, 0))
                assert all(abs(a - b) <= 2 for a, b in zip(pixel, expected))
        assert source.read_bytes() == original
        released = [face['cacheId'] for face in printing['faces']]
        request({'version': 1, 'id': 3, 'op': 'release', 'cacheIds': released})
        assert all(not (directory / 'card-cache' / (cache_id + '.png')).exists() for cache_id in released)
        refreshed = request({'version': 1, 'id': 4, 'op': 'import', 'game': 'mtg',
                             'format': 'scryfall_json', 'input': {'kind': 'file', 'value': str(source)}})['result']
        fresh_faces = refreshed['entries'][0]['printing']['faces']
        assert len(fresh_faces) == 2
        assert not set(released) & {face['cacheId'] for face in fresh_faces}
        assert all((directory / 'card-cache' / (face['cacheId'] + '.png')).is_file() for face in fresh_faces)
        csv = ('name,Set,Collector Number,image URL,image Back URL\n'
               f'Custom Éowyn,ltr,001,{url}/front.jpg,{url}/back.png\n')
        csv += csv.splitlines(keepends=True)[1]
        imported = request({'version': 1, 'id': 2, 'op': 'import', 'game': 'mtg',
                            'format': 'cubecobra_csv', 'input': {'kind': 'text', 'value': csv}})['result']
        assert imported['status'] == 'success'
        assert len(imported['entries']) == 1
        assert imported['entries'][0]['qty'] == 2
        assert imported['entries'][0]['printing']['paired']
        assert len(imported['entries'][0]['printing']['faces']) == 2
    assert not list((directory / 'card-cache').glob('*.png'))


def test_frozen_custom_template_pdf_calibration_and_translation(native):
    directory, env, executable = native
    # Start PDF first to prove runtime catalog refresh after another worker saves a layout.
    with worker(executable('pdf_worker'), directory, env) as pdf:
        pdf({'command': 'pdf_capabilities'})
        with worker(executable('template_worker'), directory, env) as templates:
            result = templates({'command': 'single', 'card_width': '60mm', 'card_height': '85mm',
                                'card_name': 'native_card', 'paper_width': '11in', 'paper_height': '8.5in',
                                'paper_name': 'native_paper', 'orientation': 'landscape', 'save': True,
                                'output_path': str(directory / 'cut-原稿.dxf')})
            assert Path(result['path']).is_file()
        catalog = pdf({'command': 'pdf_capabilities'})['result']
        choices = {option['name']: option['choices'] for option in catalog['options']}
        assert 'native_card' in choices['card_size'] and 'native_paper' in choices['paper_size']
        Image.new('RGB', (60, 85), 'navy').save(directory / 'front' / 'Card é.png')
        output = directory / 'output' / 'cards-é.pdf'
        result = pdf({'command': 'create_pdf', 'argv': ['--card_size', 'native_card', '--paper_size',
                     'native_paper', '--only_fronts', '--ppi', '72', '--output_path', str(output)]})
        assert output.is_file() and result['result']['kind'] == 'pdf'
        sheets = pdf({'command': 'generate_calibration', 'paper_sizes': ['native_paper'],
                      'output_dir': str(directory / 'calibration'), 'ppi': 72})['result']['paths']
        assert len(sheets) == 1
        for path, pages in ((output, 1), (sheets[0], 2)):
            with pdfium.PdfDocument(path) as document:
                assert len(document) == pages
                assert sorted(document[0].get_size()) == pytest.approx([612, 792], abs=1)

    source = directory / 'entrée-原稿.md'
    text = '\n---\n'.join(f'### Card {index} {{W}}{{2}}{{U}}\n\n**Bold**, *italic*.\nDraw a card.' for index in range(24))
    source.write_text(text, encoding='utf-8')
    output = directory / 'output' / 'translated-零.pdf'
    result = subprocess.run([executable('translated_text_boxes_to_pdf'), '--input_path', str(source),
                             '--output_path', str(output), '--paper_size', 'native_paper',
                             '--ppi', '72', '--quality', '0'], cwd=directory, env=env,
                            capture_output=True, text=True, encoding='utf-8', timeout=TIMEOUT)
    assert result.returncode == 0, result.stderr + result.stdout
    assert source.read_text(encoding='utf-8') == text
    with pdfium.PdfDocument(output) as document:
        assert len(document) > 1
        assert document[0].get_size() == pytest.approx((792, 612), abs=1)
        image = document[0].render(scale=0.25).to_pil().convert('RGB')
        assert image.getextrema() != ((255, 255), (255, 255), (255, 255))
