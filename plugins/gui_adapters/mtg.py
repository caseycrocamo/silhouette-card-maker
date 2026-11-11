"""Structured MTG imports. Files are staged; successful rows survive retries."""
import contextlib
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import uuid
from urllib.parse import urlparse
from PIL import Image
import requests
from plugins.mtg import deck_formats, mpcfill, scryfall
from plugins.mtg.common import ScryfallLanguage
from plugins.mtg.selection_options import validate_options

FORMATS = [{'id': item.value, 'label': item.value.replace('_', ' ').upper(),
            'inputKind': 'url' if item.value == 'url' else 'file' if item.value in
            ('cubecobra_csv', 'scryfall_json', 'mpcfill_xml') else 'text'} for item in deck_formats.DeckFormat]

def descriptor():
    return {'id': 'mtg', 'label': 'Magic: The Gathering', 'formats': FORMATS, 'inputKind': 'text',
            'sourceChoices': [], 'scenarioChoices': [], 'backs': [{'id': 'front', 'label': 'Front'}, {'id': 'back', 'label': 'Back'}],
            'workflows': ['front_only', 'double_sided']}

class MtgImporter:
    def __init__(self, root):
        self.root = Path(root)
        self.jobs = {}
        self._pending_images = None

    def cached_faces(self):
        for job in self.jobs.values():
            for cards, related in job['resolved'].values():
                for card in cards + related:
                    yield from card.get('faces', [])

    def invalidate(self, cache_ids):
        released = set(cache_ids)
        for job in self.jobs.values():
            for row_id, (cards, related) in list(job['resolved'].items()):
                if any(face.get('cacheId') in released for card in cards + related
                       for face in card.get('faces', [])):
                    del job['resolved'][row_id]

    def image(self, data, name):
        target = self.root / (uuid.uuid4().hex + '.png')
        if self._pending_images is not None:
            self._pending_images.append(target)
        with Image.open(io.BytesIO(data)) as image:
            image.convert('RGBA').save(target, 'PNG')
        return {'cacheId': target.stem, 'url': target.as_uri(), 'name': name}

    def download(self, url, name):
        if urlparse(url).scheme not in ('https', 'http'):
            raise ValueError('Image URL must use HTTP or HTTPS')
        response = requests.get(url, timeout=45, headers={'User-Agent': 'silhouette-card-maker/1.3'})
        response.raise_for_status()
        return self.image(response.content, name)

    def parse(self, text, fmt):
        rows, errors = [], []
        def add(index, name, set_code='', number='', qty=1):
            if not name or not isinstance(qty, int) or isinstance(qty, bool) or qty < 1:
                raise ValueError('Each card needs a name and positive whole quantity')
            rows.append({'id': f'row-{len(rows)+1}', 'name': name, 'setCode': set_code or '',
                         'number': str(number or ''), 'qty': qty, 'provenance': 'scryfall'})
        if fmt == 'default':
            for i, raw in enumerate(text.splitlines(), 1):
                line = raw.strip()
                if not line or line.lower().rstrip(':') in ('deck', 'sideboard', 'commander', 'companion') or line.startswith('//'):
                    continue
                match = re.match(r'^(?:(\d+)x?\s+)?(.+?)(?:\s+\(([^)]+)\)(?:\s+(\S+))?)?(?:\s+\[.*)?$', line)
                if match:
                    qty, name, code, number = match.groups()
                    try: add(i, name, code, number, int(qty or 1))
                    except ValueError as exc: errors.append({'line': i, 'message': str(exc)})
            return rows, errors
        if fmt in ('cubecobra_csv', 'scryfall_json'):
            if fmt == 'cubecobra_csv':
                reader = csv.DictReader(io.StringIO(text))
                if not reader.fieldnames or 'name' not in reader.fieldnames:
                    raise ValueError('CubeCobra CSV needs a name column')
            def custom(index, name, code, number, qty, front, back):
                add(index, name, code, number, qty)
                rows[-1].update(provenance='custom', frontUrl=front, backUrl=back)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                deck_formats.parse_deck(text, deck_formats.DeckFormat(fmt), add, image_handler=custom)
            errors.extend({'message': line} for line in output.getvalue().splitlines() if line.startswith('Error'))
        elif fmt == 'mpcfill_xml':
            def slot(index, front, name, back, back_name):
                add(index, name)
                rows[-1].update(provenance='mpcfill', frontId=front, backId=back, slot=index)
            deck_formats.parse_mpcfill_xml(text, slot)
        else:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                deck_formats.parse_deck(text, deck_formats.DeckFormat(fmt), add)
            for line in output.getvalue().splitlines():
                if line.startswith(('Error', 'Failed', 'URL not recognized')):
                    errors.append({'message': line})
        if not rows and not errors: errors.append({'message': 'No cards were imported'})
        return rows, errors

    def resolve(self, row, options):
        # A back or related-token failure must roll back this row only.
        pending = []
        self._pending_images = pending
        try:
            return self._resolve(row, options)
        except Exception:
            for path in pending:
                path.unlink(missing_ok=True)
            raise
        finally:
            self._pending_images = None

    def _resolve(self, row, options):
        if row['provenance'] in ('custom', 'mpcfill'):
            if row['provenance'] == 'custom':
                front = self.download(row['frontUrl'], row['name'])
                back = self.download(row['backUrl'], row['name']+' back') if row.get('backUrl') else None
            else:
                def mpc(card_id, name):
                    data = mpcfill.get_cached_image(card_id)
                    if not data: raise ValueError('MPCFill image is unavailable')
                    return self.image(data, name)
                front = mpc(row['frontId'], row['name'])
                back = mpc(row['backId'], row['name']+' back') if row.get('backId') else None
            return [{'id': row['id'], 'name': row['name'], 'faces': [front] + ([back] if back else []),
                     'paired': bool(back), 'custom': True}], []
        cards = []
        def art(raw, index, quantity, clean_name, card_set, number, layout, all_parts=None,
                card_name=None, prefer_langs=None, front_img_dir=None, double_sided_dir=None):
            with tempfile.TemporaryDirectory(prefix='gui-mtg-') as tmp:
                front = Path(tmp)/'front'; back = Path(tmp)/'back'; front.mkdir(); back.mkdir()
                scryfall.fetch_card_art(index, 1, clean_name, card_set, number, layout, all_parts,
                                       card_name, prefer_langs, str(front), str(back))
                face = next(front.iterdir(), None)
                if face is None: raise ValueError('No front image was returned')
                faces = [self.image(face.read_bytes(), raw['name'])]
                reverse = next(back.iterdir(), None)
                if reverse: faces.append(self.image(reverse.read_bytes(), raw['name']+' back'))
            card = dict(raw, set=card_set, collector_number=str(number))
            cards.append({'id': card.get('id') or f'{card_set}:{number}', 'name': card['name'],
                          'setCode': card_set.upper(), 'number': str(number), 'faces': faces,
                          'paired': bool(reverse), 'rawCard': card, 'printsUrl': card.get('prints_search_uri'),
                          'token': bool(cards), 'parentId': row['id'] if cards else None})
        scryfall.fetch_card(1, row['qty'], row['setCode'], row['number'], options['ignore_set_and_collector_number'],
                           row['name'], options['prefer_older_sets'], options['prefer_set'], options['ignore_set'],
                           options['prefer_showcase'], options['prefer_extra_art'], options['prefer_ub'], options['ignore_ub'],
                           [ScryfallLanguage(lang) for lang in options['prefer_lang']] or None,
                           options['tokens'], '', '', art_handler=art)
        return cards[:1], cards[1:]

    def import_game(self, request):
        fmt = request.get('format', 'default')
        if fmt not in ['default'] + [item['id'] for item in FORMATS]: raise ValueError('Unsupported MTG format')
        options = validate_options(request.get('options'))
        source = request.get('input') or {}
        text = source.get('value')
        if source.get('kind') == 'file':
            path = Path(text)
            if not path.is_file() or path.stat().st_size > 2_000_000: raise ValueError('Choose a deck file smaller than 2 MB')
            text = path.read_text(encoding='utf-8-sig')
        if not isinstance(text, str) or len(text) > 2_000_000 or not text.strip(): raise ValueError('Enter a deck source')
        key = hashlib.sha256(json.dumps([fmt,text,options],sort_keys=True).encode()).hexdigest()
        if key not in self.jobs:
            rows, errors = self.parse(text, fmt)
            self.jobs[key] = {'rows': rows, 'errors': errors, 'resolved': {}}
            if len(self.jobs) > 20: self.jobs.pop(next(iter(self.jobs)))
        job = self.jobs[key]; entries=[]; errors=list(job['errors']); tokens={}
        for row in job['rows']:
            try:
                cached = job['resolved'].get(row['id'])
                if cached and any(not (self.root / (face['cacheId'] + '.png')).is_file()
                                  for card in cached[0] + cached[1] for face in card.get('faces', [])
                                  if face.get('cacheId')):
                    del job['resolved'][row['id']]
                if row['id'] not in job['resolved']:
                    job['resolved'][row['id']] = self.resolve(row, options)
                cards, related = job['resolved'][row['id']]
                for card in cards: entries.append(dict(row, printing=card))
                for token in related:
                    identity=token['id']
                    if identity not in tokens: tokens[identity]=dict(id='token-'+identity,name=token['name'],qty=0,printing=token,token=True,parentId=row['id'])
                    tokens[identity]['qty'] += row['qty']
            except Exception as exc:
                entries.append(dict(row, error=str(exc)))
        entries.extend(tokens.values())
        return {'entries':entries,'errors':errors,'warnings':[], 'status':'partial' if errors or any(not e.get('printing') for e in entries) else 'success'}
