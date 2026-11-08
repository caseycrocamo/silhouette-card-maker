"""Versioned card lookup worker. stdout contains only NDJSON protocol records."""
import contextlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import uuid

from plugins.pokemon.deck_formats import parse_limitless_result
from plugins.pokemon.limitless import resolve_card


class CardWorker:
    def __init__(self, cache_dir=None):
        self.root = Path(cache_dir or tempfile.mkdtemp(prefix='card-maker-cache-')).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.cache = {}
        # Keep recent images available to restored sessions after a worker crash.
        # Sweep only our generated names; never remove unrelated cache files.
        for candidate in self.root.glob('*.png'):
            if re.fullmatch(r'[a-f0-9]{32}\.png', candidate.name):
                try:
                    if candidate.stat().st_mtime < time.time() - 86400:
                        candidate.unlink()
                except FileNotFoundError:
                    pass

    def release(self, ids):
        if not isinstance(ids, list) or any(not isinstance(i, str) or not re.fullmatch(r'[a-f0-9]{32}', i) for i in ids):
            raise ValueError('Invalid cache IDs')
        for cache_id in ids:
            (self.root / f'{cache_id}.png').unlink(missing_ok=True)
        self.cache = {k: v for k, v in self.cache.items() if v['cacheId'] not in ids}
        return {'released': len(ids)}

    def handle(self, request):
        if request.get('version') != 1:
            raise ValueError('Unsupported protocol version')
        op = request.get('op')
        if op == 'parse':
            text = request.get('text')
            if not isinstance(text, str) or len(text) > 2_000_000:
                raise ValueError('Invalid deck text')
            return parse_limitless_result(text)
        if op == 'release':
            return self.release(request.get('cacheIds'))
        if op != 'resolve':
            raise ValueError('Unknown card operation')
        entry = request.get('entry')
        if not isinstance(entry, dict):
            raise ValueError('Invalid card entry')
        name, code, number = (entry.get(k) for k in ('name', 'setCode', 'number'))
        if any(not isinstance(v, str) or not v or len(v) > 300 for v in (name, code, number)):
            raise ValueError('Invalid card printing')
        key = (code.upper(), number)
        previous = self.cache.get(key)
        if previous and (self.root / f"{previous['cacheId']}.png").is_file():
            return previous
        image = resolve_card(name, code, number, strict=True)
        cache_id = uuid.uuid4().hex
        target = self.root / f'{cache_id}.png'
        target.write_bytes(image.pop('bytes'))
        printing = dict(image, id=f'{image["source"]}:{code.upper()}:{number}', name=name,
                        setCode=code.upper(), number=number, cacheId=cache_id,
                        faces=[{'url': target.as_uri(), 'name': name}])
        self.cache[key] = printing
        return printing


def main():
    worker = CardWorker(os.environ.get('CARD_MAKER_CACHE_DIR'))
    print(json.dumps({'version': 1, 'ready': True}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                request = {}
                raise ValueError('Request must be an object')
            with contextlib.redirect_stdout(sys.stderr):
                result = worker.handle(request)
            response = {'version': 1, 'id': request.get('id'), 'result': result}
        except Exception as error:
            response = {'version': 1, 'id': request.get('id'), 'error': str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)
    worker.release([v['cacheId'] for v in worker.cache.values()])


if __name__ == '__main__':
    main()
