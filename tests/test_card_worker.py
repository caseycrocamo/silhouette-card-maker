import io
import json
from unittest.mock import Mock

import pytest
from PIL import Image

from card_worker import CardWorker
from plugins.pokemon.deck_formats import parse_limitless_result
from plugins.pokemon import limitless


def png():
    stream = io.BytesIO()
    Image.new('RGB', (50, 70)).save(stream, 'PNG')
    return stream.getvalue()


def test_parse_reports_lines_and_keeps_identifiers():
    result = parse_limitless_result("Pokémon: 3\r\n2  Farfetch'd  A1  001\r\n0 Pikachu SVI 047\nTrainer: 1\n1 Nest Ball SVI\nTotal Cards: 3")
    assert result['entries'][0]['number'] == '001'
    assert result['entries'][0]['setCode'] == 'A1'
    assert result['entries'][0]['qty'] == 2
    assert [e['line'] for e in result['errors']] == [3, 5]
    assert result['ignored'] == [1, 4, 6]


def test_worker_cache_and_release(tmp_path, monkeypatch):
    resolver = Mock(return_value={'bytes': png(), 'source': 'tcg', 'mime': 'image/png', 'width': 50, 'height': 70})
    monkeypatch.setattr('card_worker.resolve_card', resolver)
    worker = CardWorker(tmp_path)
    request = {'version': 1, 'op': 'resolve', 'entry': {'name': 'Pikachu', 'setCode': 'SVI', 'number': '047'}}
    first = worker.handle(request)
    assert worker.handle(request) == first
    assert resolver.call_count == 1
    assert (tmp_path / (first['cacheId'] + '.png')).exists()
    worker.handle({'version': 1, 'op': 'release', 'cacheIds': [first['cacheId']]})
    assert not list(tmp_path.iterdir())
    with pytest.raises(ValueError):
        worker.release(['../../bad'])


def test_resolver_missing_card_does_not_poison_set(monkeypatch):
    calls = []
    def request(url):
        calls.append(url)
        if '_047_' in url:
            raise limitless.HTTPError('missing')
        return Mock(content=png())
    monkeypatch.setattr(limitless, 'request_limitless', request)
    with pytest.raises(ValueError):
        limitless.resolve_card('Missing', 'SVI', '047')
    result = limitless.resolve_card('Other', 'SVI', '048')
    assert result['source'] == 'tcg'
    assert any('_048_' in url for url in calls)


def test_resolver_rejects_invalid_images_and_unsafe_ids(monkeypatch):
    monkeypatch.setattr(limitless, 'request_limitless', lambda url: Mock(content=b'not image'))
    with pytest.raises(ValueError):
        limitless.resolve_card('Card', 'SVI', '047')
    with pytest.raises(ValueError):
        limitless.resolve_card('Card', '../SVI', '047')


def test_worker_protocol_survives_bad_request(tmp_path):
    import subprocess
    import sys
    import os
    result = subprocess.run([sys.executable, 'card_worker.py'], input='bad json\n'+json.dumps({'version':1,'id':2,'op':'parse','text':'1 Pikachu SVI 047'})+'\n', text=True, capture_output=True, env=dict(os.environ, CARD_MAKER_CACHE_DIR=str(tmp_path)))
    records = [json.loads(line) for line in result.stdout.splitlines()]
    assert records[0]['ready']
    assert 'error' in records[1]
    assert records[2]['id'] == 2
    assert records[2]['result']['entries'][0]['name'] == 'Pikachu'


def test_request_timeout_and_retry_after(monkeypatch):
    responses = [Mock(status_code=429, headers={'Retry-After': '3'}), Mock(status_code=200)]
    get = Mock(side_effect=responses)
    delays = []
    monkeypatch.setattr(limitless.session, 'get', get)
    monkeypatch.setattr(limitless, 'sleep', delays.append)
    assert limitless.request_limitless('https://example.test/card') is responses[1]
    assert get.call_args.kwargs['timeout'] == (5, 20)
    assert delays == [3, 0.075]


def test_worker_rejects_unknown_protocol_and_operations(tmp_path):
    worker = CardWorker(tmp_path)
    for request in ({'version': 2, 'op': 'parse'}, {'version': 1, 'op': 'delete'}, {'version': 1, 'op': 'resolve', 'entry': {}}):
        with pytest.raises(ValueError):
            worker.handle(request)


def test_strict_search_rejects_other_set(monkeypatch):
    def missing(url):
        raise limitless.HTTPError('missing')
    monkeypatch.setattr(limitless, 'request_limitless', missing)
    def request(url, params=None):
        if params:
            return Mock(json=lambda: {'data': [{'set': {'id': 'other'}, 'number': '1', 'images': {'large': 'https://example.test/wrong'}}]})
        raise limitless.HTTPError('missing')
    monkeypatch.setattr(limitless, 'request_pokemontcg', request)
    with pytest.raises(ValueError, match='No verified image'):
        limitless.resolve_card('Card', 'BS', '1')


def test_worker_removes_expired_orphans_only(tmp_path):
    import os
    import time
    stale = tmp_path / ('a' * 32 + '.png')
    recent = tmp_path / ('b' * 32 + '.png')
    other = tmp_path / 'user-image.png'
    for file in (stale, recent, other):
        file.write_bytes(png())
    os.utime(stale, (time.time() - 90000,) * 2)
    CardWorker(tmp_path)
    assert not stale.exists()
    assert recent.exists() and other.exists()


def test_pocket_and_old_set_sources(monkeypatch):
    def request(url):
        if '/pocket/' in url:
            return Mock(content=png())
        raise limitless.HTTPError('missing')
    monkeypatch.setattr(limitless, 'request_limitless', request)
    assert limitless.resolve_card('Card', 'A1', '001')['source'] == 'pocket'
    monkeypatch.setattr(limitless, 'request_limitless', lambda url: (_ for _ in ()).throw(limitless.HTTPError('missing')))
    cdn = Mock(return_value=Mock(content=png()))
    monkeypatch.setattr(limitless, 'request_pokemontcg', cdn)
    result = limitless.resolve_card('Card', 'BS', '001')
    assert result['source'] == 'pokemontcg'
    assert cdn.call_args.args[0].endswith('/base1/1_hires.png')


def test_mtg_release_invalidates_cached_row_and_refetches(tmp_path, monkeypatch):
    from plugins.gui_adapters.mtg import MtgImporter
    worker = CardWorker(tmp_path)
    calls = []
    def resolve(importer, row, options):
        calls.append(row['id'])
        front = importer.image(png(), row['name'])
        back = importer.image(png(), row['name'] + ' back')
        token = importer.image(png(), 'Token')
        return ([{'id': row['id'], 'faces': [front, back]}],
                [{'id': 'shared-token', 'name': 'Token', 'faces': [token]}])
    monkeypatch.setattr(MtgImporter, 'resolve', resolve)
    payload = {'version': 1, 'op': 'import', 'game': 'mtg', 'format': 'mtgo',
               'input': {'kind': 'text', 'value': '2 Maker\n1 Other'}}
    first = worker.handle(payload)
    ids = {value['cacheId'] for value in worker.cache.values()}
    assert len(ids) == 6  # Both parent pairs and both cached token images are owned.
    assert len(first['entries']) == 3  # Repeated token identity produces one displayed row.
    released = first['entries'][0]['printing']['faces'][0]['cacheId']
    worker.release([released])
    second = worker.handle(payload)
    assert calls == ['row-1', 'row-2', 'row-1']
    assert second['entries'][0]['printing']['faces'][0]['cacheId'] != released
    assert not (tmp_path / (released + '.png')).exists()
    worker.release([value['cacheId'] for value in worker.cache.values()])
    assert not list(tmp_path.glob('*.png'))


def test_mtg_worker_eof_removes_all_cached_faces(tmp_path):
    import os
    from pathlib import Path
    import subprocess
    import sys
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    import threading
    image = png()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(image)
        def log_message(self, *_args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f'http://127.0.0.1:{server.server_port}/image.png'
        payload = {'version': 1, 'id': 1, 'op': 'import', 'game': 'mtg', 'format': 'cubecobra_csv',
                   'input': {'kind': 'text', 'value': f'name,image URL,image Back URL\nCustom,{url},{url}'}}
        result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'card_worker.py')],
                                input=json.dumps(payload) + '\n', text=True, capture_output=True,
                                env=dict(os.environ, CARD_MAKER_CACHE_DIR=str(tmp_path)), timeout=30)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout.splitlines()[1])
    assert response['result']['status'] == 'success'
    assert len(response['result']['entries'][0]['printing']['faces']) == 2
    assert not list(tmp_path.glob('*.png'))
