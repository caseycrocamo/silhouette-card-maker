"""Small, synthetic provider responses. No recorded data or network fallback.

The real parsers, HTTP adapters, image processing, and file writers still run.
Fixtures contain only fields needed by those contracts. Unknown endpoints fail.
"""
from functools import lru_cache
from io import BytesIO
import json
import random
import re
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

from PIL import Image
from requests import Response

IMAGE = 'https://fixtures.example/card.png'


@lru_cache
def image_bytes(landscape=False):
    size = (96, 64) if landscape else (64, 96)
    image = Image.frombytes('RGB', size, random.Random(10).randbytes(size[0] * size[1] * 3))
    output = BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


def response(url, data=None, *, status=200, text=None, image=False):
    result = Response()
    result.status_code = status
    result.url = url
    result.encoding = 'utf-8'
    result.headers['Content-Type'] = 'image/png' if image else 'application/json'
    result._content = image_bytes('landscape' in url) if image else (text if text is not None else json.dumps(data)).encode('utf-8')
    return result


def lotr_cards():
    names = ['Legolas', 'Thalin', 'Éowyn', 'Gondorian Spearman', 'Gandalf']
    cards = [{'code': f'{i + 1:05}', 'name': name, 'imagesrc': f'/fixture/{i}.png'} for i, name in enumerate(names)]
    # A bulk catalog includes many unrelated cards; only five are in the deck.
    cards.extend({'code': f'{i:05}', 'name': f'Card {i}', 'imagesrc': '/fixture/card.png'} for i in range(6, 1002))
    return cards


def lotr_deck():
    return {'name': 'Fixture deck', 'heroes': {'00001': 1, '00002': 1, '00003': 1},
            'slots': {'00001': 1, '00002': 1, '00003': 1, '00004': 12, '00005': 12}}


def scenario(slug):
    return {'Title': 'Passage Through Mirkwood', 'Slug': slug,
            'QuestCards': [{'Title': f'Quest {i}', 'Slug': f'quest-{i}', 'Quantity': 1,
                            'Front': {'ImagePath': 'https://fixtures.example/landscape-front.png'},
                            'Back': {'ImagePath': 'https://fixtures.example/landscape-back.png'}} for i in range(2)],
            'ScenarioCards': [{'Title': 'Forest Spider', 'Slug': 'forest-spider',
                               'NormalQuantity': 10, 'EasyQuantity': 8, 'NightmareQuantity': 12}]}


class ProviderMocks:
    def request(self, method, url, **kwargs):
        parsed = urlsplit(url)
        host, path = parsed.hostname, unquote(parsed.path)
        query = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        params = kwargs.get('params') or {}
        if isinstance(params, dict):
            query.update(params)
        body = kwargs.get('json') or {}
        expected_method = 'POST' if host == 'fftcg.square-enix-games.com' and path == '/na/get-cards' else 'GET'
        if method.upper() != expected_method:
            raise AssertionError(f'Unmocked method: {method} {url}')
        # Image hosts used by the adapters or fixture payloads. Never fall back
        # to the Internet, even if the path or hostname has a typo.
        image_hosts = {'fixtures.example', 'world.digimoncard.com', 'digimoncard.io',
                       'www.gundam-gcg.com', 'en.onepiece-cardgame.com',
                       'images.ygoprodeck.com', 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com',
                       'cdn.piltoverarchive.com', 'riftmana.com', 'nro-public.s3.nl-ams.scw.cloud',
                       'cdn.ashes.live', 'ashesdb-media.plaidhatgames.com',
                       'en.cf-vanguard.com', 'en.ws-tcg.com', 'en.shadowverse-evolve.com',
                       'en.godzilla-cardgame.com', 'en.hololive-official-cardgame.com',
                       'cards.scryfall.io', 's3.wasabisys.com'}
        if host in image_hosts and path.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            return response(url, image=True)
        if host == 'api.altered.gg' and path.startswith('/cards/'):
            return response(url, {'reference': path.rsplit('/', 1)[-1], 'imagePath': IMAGE})
        if host == 'arkhamdb.com':
            if path == '/api/public/deck/1.json':
                return response(url, text='<html>Login required</html>')
            if '/card/' in path and path.endswith('.json'):
                code = path.rsplit('/', 1)[-1].removesuffix('.json')
                card = {'code': code, 'name': f'Fixture {code}', 'imagesrc': '/fixture/front.png'}
                if code == '01121a':
                    card['linked_card'] = {'imagesrc': '/fixture/landscape-back.png'}
                if code in {'01001', '01003', '01105'}:
                    card.update(double_sided=True, backimagesrc='/fixture/landscape-back.png')
                return response(url, card)
            if re.fullmatch(r'/api/public/(deck|decklist)/[0-9]+\.json', path):
                return response(url, {'investigator_code': '01001', 'slots': {'01006': 2}})
            if path.startswith('/fixture/'):
                return response(url, image=True)
        if host in {'api.ashes.live', 'apiasheslive.plaidhatgames.com'}:
            card = {'name': 'Fixture Phoenixborn', 'stub': 'fixture-phoenixborn', 'count': 1}
            return response(url, {'phoenixborn': card, 'cards': [dict(card, count=2)], 'conjurations': []})
        if host == 'decklog-en.bushiroad.com':
            return response(url, {'game_title_id': 2, 'list': [{'name': 'Fixture card', 'num': 2, 'img': 'fixture.png'}]})
        if host == 'pphqxjttokwymgemkqvh.supabase.co' and path == '/rest/v1/decks':
            return response(url, [{'id': 122, 'is_public': True, 'deck_cards': [
                {'quantity': 2, 'cards': {'name': 'Fixture Astra card', 'image_url': IMAGE}}]}])
        if host == 'play-api.carde.io' and path.startswith('/v1/decks/'):
            return response(url, {'data': {'cards': [{'_id': 'card-1', 'name': 'Fixture Elestral', 'images': {'small': IMAGE}}],
                                          'deck': {'sections': [{'cards': [{'cardId': 'card-1', 'count': 2}]}]}}})
        if host == 'fftcg.square-enix-games.com' and path == '/na/get-cards':
            cards = [] if body.get('text') and body.get('code') else [{'images': {'full': [IMAGE]}}]
            return response(url, {'cards': cards})
        if host == 'api.cardvault.fabtcg.com' and '/card_id/' in path:
            return response(url, {'results': [{'card_prints': [{'faces': [
                {'face_language': 'en', 'finish_type': 'regular', 'image': {'normal': IMAGE}}]}]}]})
        if host == 'api.gatcg.com' and path.startswith('/cards/'):
            return response(url, {'editions': [{'image': 'fixture.png'}]})
        if host == 'api.gatcg.com' and path == '/fixture.png':
            return response(url, image=True)
        if host == 'www.archonarcana.com' and path == '/w139/api.php':
            return self.keyforge(url, query)
        if host == 'www.keyforgegame.com' and path.startswith('/api/decks/'):
            cards = [{'id': str(i), 'card_title_en': 'Gracchan Reform' if i == 0 else f'Card {i}'} for i in range(38)]
            return response(url, {'_linked': {'cards': cards}, 'data': {'_links': {'cards': ['0'] * 3 + [str(i) for i in range(1, 38)]}}})
        if host == 'api.lorcast.com':
            if path == '/v0/sets':
                return response(url, {'results': [{'code': '1'}, {'code': 'P2'}]})
            if path == '/v0/cards/search':
                q = query.get('q', '').lower()
                rarity = 'Epic' if 'rarity:epic' in q else 'Iconic' if 'rarity:iconic' in q else 'Promo' if 'set:p2' in q else 'Common'
                return response(url, {'results': [{'name': 'Fixture Lorcana card', 'rarity': rarity,
                    'set': {'code': 'P2' if 'set:p2' in q else '1'}, 'collector_number': '15',
                    'image_uris': {'digital': {'large': IMAGE}}}]})
        if host == 'ringsdb.com':
            if path == '/api/public/cards/':
                return response(url, lotr_cards())
            if '/api/public/decklist/' in path:
                return response(url, lotr_deck())
            if '/api/public/scenario/' in path:
                return response(url, {'name': 'Passage Through Mirkwood'})
            if path.startswith('/fellowship/view/'):
                deck = json.dumps(lotr_deck())
                return response(url, text=f'<h1>Fixture fellowship</h1><script>Decks[0] = {deck};Decks[1] = {deck};</script>')
            if path.startswith('/fixture/'):
                return response(url, image=True)
        if host == 'hallofbeorn.com':
            if path == '/Export/Scenarios':
                return response(url, [{'Title': 'Passage Through Mirkwood', 'Slug': 'Passage-Through-Mirkwood'}])
            if path.startswith('/Export/Scenarios/'):
                return response(url, scenario(path.rsplit('/', 1)[-1]))
            if path == '/Export/Cards/OFFICIAL':
                return response(url, [{'url': 'https://hallofbeorn.com/LotR/Details/forest-spider', 'imagesrc': IMAGE}])
        if host == 'api.scryfall.com':
            return self.scryfall(url, path, query)
        if host == 'api.netrunnerdb.com' and path.startswith('/api/v3/public/'):
            return response(url, {'data': {'attributes': {'latest_printing_id': 'fixture-print'}}})
        if host == 'piltoverarchive.com' and path == '/api/external/v1/cards':
            return response(url, {'data': [{'card': {'name': 'Seal of Unity'}, 'variantNumber': 'OGN-245', 'variantType': 'Standard'}]})
        if host == 'curiosa.io' and path.startswith('/api/trpc/'):
            card = {'quantity': 2, 'variantId': 'variant-1', 'card': {'name': 'Fixture Sorcery card', 'variants': [{'id': 'variant-1', 'src': IMAGE}]}}
            return response(url, [{'result': {'data': {'json': [card]}}}])
        if host == 'api.swu-db.com' and path.startswith('/cards/'):
            number = int(path.rsplit('/', 1)[-1])
            name, title, kind = {304: ('Count Dooku', 'Darth Tyrannus', 'Unit'),
                                 17: ('Han Solo', 'Audacious Smuggler', 'Leader'),
                                 29: ('Fixture Base', '', 'Base'),
                                 134: ('Bib Fortuna', 'Die Wanna Wanga?', 'Unit')}[number]
            return response(url, {'Name': name, 'Subtitle': title, 'Type': kind})
        if host == 'swudb.com':
            if path.startswith('/api/search/'):
                return response(url, {'printings': [{'frontImagePath': '/images/cards/sor/017.png', 'backImagePath': '/images/cards/sor/017b.png' if any(name in path for name in ['Leia', 'Han Solo']) else ''}]})
            if path.startswith('/images/cards/'):
                return response(url, image=True)
        if host == 'db.ygoprodeck.com' and path == '/api/v7/cardinfo.php':
            return response(url, {'data': [{'id': 89631139, 'name': 'Blue-Eyes White Dragon'}]})
        raise AssertionError(f'Unmocked provider endpoint: {method} {url} params={params}')

    def keyforge(self, url, query):
        title = query.get('titles') or query.get('search') or ''
        names = ['Ecto-Charge', 'Æmber Imp', 'Nature’s Call', 'Gĕzdrutyŏ the Arcane', 'Gracchan Reform']
        def normal(s):
            from plugins.keyforge.archonarcana import normalize_title
            return normalize_title(s)
        canonical = next((name for name in names if normal(name) == normal(title)), None)
        if title.startswith('Card '):
            canonical = title
        if query.get('action') == 'opensearch':
            return response(url, [title, [canonical] if canonical else [], [], []])
        page = {'title': canonical, 'original': {'source': 'https://s3.wasabisys.com/fixture/card.png'}} if canonical else {'title': title, 'missing': True}
        return response(url, {'query': {'pages': [page]}})

    def scryfall(self, url, path, query):
        if query.get('format') == 'image':
            return response(url, image=True)
        name = query.get('exact', 'Lightning Bolt')
        if path == '/cards/named' and name == "Donnie's Bō":
            return response(url, {'object': 'error'}, status=404)
        if path == '/cards/search':
            q = query.get('q', '')
            sets = ['acr'] if 'Excalibur' in q or '9fb6bd72-031b-40a1-83c5-8a1c82f84e12' in q else ['one', 'sld']
            if '-is:ub' in q:
                sets = [s for s in sets if s == 'one']
            elif 'is:ub' in q:
                sets = [s for s in sets if s != 'one']
            return response(url, {'data': [self.mtg_card('Fixture card', s, '1') for s in sets]})
        if path.startswith('/cards/') and path != '/cards/named':
            parts = path.strip('/').split('/')
            set_code, number = parts[1:3]
            layout = {'znr': 'modal_dfc', 'sld': 'reversible_card', 'emn': 'meld'}.get(set_code, 'normal')
            card = self.mtg_card('Fixture card', set_code, number, layout)
            if layout == 'meld':
                card['name'] = 'Gisela, the Broken Blade'
                card['all_parts'] = [{'component': 'meld_part', 'name': card['name'], 'uri': 'https://api.scryfall.com/cards/emn/28'},
                                     {'component': 'meld_part', 'name': 'Bruna, the Fading Light', 'uri': 'https://api.scryfall.com/cards/emn/15'},
                                     {'component': 'meld_result', 'name': 'Brisela, Voice of Nightmares', 'uri': 'https://api.scryfall.com/cards/emn/28b'}]
            return response(url, card)
        if path == '/cards/named':
            return response(url, self.mtg_card(name, 'one', '1'))
        raise AssertionError(f'Unmocked Scryfall endpoint: {url}')

    @staticmethod
    def mtg_card(name, set_code, number, layout='normal'):
        return {'name': name, 'set': set_code, 'collector_number': number, 'layout': layout,
                'prints_search_uri': 'https://api.scryfall.com/cards/search?' + urlencode({'q': name}),
                'image_uris': {'png': IMAGE}, 'lang': 'en', 'nonfoil': True, 'digital': False,
                'promo': False, 'full_art': False, 'border_color': 'black', 'frame_effects': []}
