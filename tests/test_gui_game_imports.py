import unittest
import tempfile
from enum import Enum
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image
import importlib
import contextlib
import io
from urllib.parse import urlparse
from urllib.request import url2pathname

from plugins.gui_imports import GAMES, GameImporter, capabilities


class GameImportCapabilityTests(unittest.TestCase):
    def test_capabilities_cover_all_supported_plugins(self):
        result = capabilities()['games']
        self.assertEqual({game['id'] for game in result}, set(GAMES))
        self.assertEqual(20, len(result))
        for game in result:
            self.assertTrue(game['formats'])
            self.assertTrue(all({'id', 'label', 'inputKind'} <= format.keys() for format in game['formats']))

    def test_yugioh_distinguishes_ydke_from_ydk_file_input(self):
        games = {game['id']: game for game in capabilities()['games']}
        formats = {item['id']: item['inputKind'] for item in games['yugioh']['formats']}
        self.assertEqual({'ydke': 'opaque', 'ydk': 'file'}, formats)

    def test_import_rejects_unknown_format_and_bad_input(self):
        importer = GameImporter(self._cache_path())
        with self.assertRaises(ValueError):
            importer.import_game({'game': 'digimon', 'format': 'missing', 'input': {'kind': 'text', 'value': 'x'}})
        with self.assertRaises(ValueError):
            importer.import_game({'game': 'digimon', 'format': 'tts', 'input': {'kind': 'url', 'value': 'x'}})

    def test_printed_parser_error_keeps_successful_cards_as_partial(self):
        with tempfile.TemporaryDirectory() as cache:
            def factory(directory):
                def handle(*args): Image.new('RGB', (8, 8), 'red').save(Path(directory) / '1-Sample.png')
                return handle
            def parser(value, fmt, handler):
                handler()
                print('Errors: one card code was not found')
            parser_fake=SimpleNamespace(DeckFormat=lambda value:value,parse_deck=parser)
            api_fake=SimpleNamespace(get_handle_card=factory)
            with patch('plugins.gui_imports.importlib.import_module', side_effect=lambda name: parser_fake if name==GAMES['digimon'][2] else api_fake):
                result=GameImporter(cache).import_game({'game':'digimon','format':'tts','input':{'kind':'text','value':'fixture'}})
            self.assertEqual('partial',result['status'])
            self.assertEqual(1,len(result['entries']))
            self.assertIn('Errors:',result['errors'][0]['message'])

    def test_all_plugin_dispatchers_use_staged_handlers(self):
        descriptors = {item['id']: item for item in capabilities()['games']}
        for game, (_, kind, parser_module, api_module, backs) in GAMES.items():
            with self.subTest(game=game), tempfile.TemporaryDirectory() as cache:
                importer = GameImporter(cache)

                def make_handler(*args):
                    dirs = [Path(value) for value in args if isinstance(value, str) and Path(value).is_dir()]
                    front = dirs[-1] if game in ('ashes_reborn', 'riftbound') else dirs[0]
                    back = dirs[1] if len(dirs) > 1 else None
                    def handle(*_args, **_kwargs):
                        Image.new('RGB', (8, 8), 'red').save(front / '1-Sample1.png')
                        if back:
                            Image.new('RGB', (8, 8), 'blue').save(back / '1-Sample1.png')
                    return handle

                parser_fake = SimpleNamespace(
                    DeckFormat=lambda value: value,
                    parse_deck=lambda value, fmt, handler, **kw: handler(),
                )
                api_fake = SimpleNamespace(get_handle_card=make_handler)
                modules = {parser_module: parser_fake, api_module: api_fake}
                for special in ('ashes_reborn', 'riftbound'):
                    if game == special:
                        names = [item['id'] for item in descriptors[game]['sourceChoices']]
                        api_fake.ImageServer=Enum('ImageServer', {name.upper(): name for name in names})
                if game == 'yugioh':
                    parser_fake.parse_deck = lambda value, fmt: {'1': 1}
                    def fetch(code, qty, output):
                        Image.new('RGB', (8, 8), 'red').save(Path(output) / '1-Sample1.png')
                    api_fake.fetch_card_art=fetch
                real_import = importlib.import_module
                with patch('plugins.gui_imports.importlib.import_module', side_effect=lambda name: modules[name] if name in modules else real_import(name)):
                    fmt = descriptors[game]['formats'][0]
                    result = importer.import_game({'game': game, 'format': fmt['id'], 'input': {'kind': fmt['inputKind'], 'value': 'sample'}, 'options': {}})
                self.assertEqual('success', result['status'])
                self.assertEqual(1, len(result['entries']))
                self.assertTrue(Path(cache, result['entries'][0]['cacheId'] + '.png').is_file())
                self.assertEqual('back' in backs, bool(result['entries'][0].get('back')))

    def test_real_digimon_parser_keeps_quantities_names_and_ignores_headers(self):
        with tempfile.TemporaryDirectory() as cache:
            def fetch(index, code, quantity, output):
                for copy in range(1, quantity + 1):
                    Image.new('RGB', (8, 8), 'red').save(Path(output) / f'{index}_{code}_{copy}.png')
            with patch('plugins.digimon.digimoncard.fetch_card_art', side_effect=fetch):
                result=GameImporter(cache).import_game({
                    'game':'digimon','format':'digimoncardio',
                    'input':{'kind':'text','value':'Deck Name\n3 Agumon BT1-001\n2 Gabumon BT1-002'},
                })
            self.assertEqual('success',result['status'])
            self.assertEqual([('Agumon',3),('Gabumon',2)],[(item['name'],item['qty']) for item in result['entries']])
            self.assertEqual([],result['errors'])

    def test_yugioh_preserves_parser_insertion_order_and_repeated_quantity(self):
        with tempfile.TemporaryDirectory() as cache, tempfile.TemporaryDirectory() as files:
            deck=Path(files)/'ordered.ydk'
            deck.write_text('#main\n200\n100\n200\n#extra\n',encoding='utf-8')
            def fetch(code, quantity, output):
                for copy in range(1, quantity + 1):
                    Image.new('RGB',(8,8),'blue').save(Path(output)/f'{code}_{copy}.jpg')
            with patch('plugins.yugioh.ygoprodeck.fetch_card_art',side_effect=fetch):
                result=GameImporter(cache).import_game({
                    'game':'yugioh','format':'ydk','input':{'kind':'file','value':str(deck)},
                })
            self.assertEqual('success',result['status'])
            self.assertEqual([('200',2),('100',1)],[(item['name'],item['qty']) for item in result['entries']])

    def test_real_parser_retains_successful_cards_when_one_fetch_fails(self):
        with tempfile.TemporaryDirectory() as cache:
            def fetch(index, code, quantity, output):
                if code == 'BT1-002':
                    raise RuntimeError('fixture fetch failed')
                Image.new('RGB',(8,8),'red').save(Path(output)/f'{index}_{code}_1.png')
            with patch('plugins.digimon.digimoncard.fetch_card_art',side_effect=fetch):
                result=GameImporter(cache).import_game({
                    'game':'digimon','format':'digimoncardio',
                    'input':{'kind':'text','value':'1 Agumon BT1-001\n1 Gabumon BT1-002'},
                })
            self.assertEqual('partial',result['status'])
            self.assertEqual([('Agumon',1)],[(item['name'],item['qty']) for item in result['entries']])
            self.assertTrue(any('fixture fetch failed' in error['message'] for error in result['errors']))

    def test_real_arkham_handler_surfaces_missing_back_warning(self):
        from types import SimpleNamespace
        image_bytes=io.BytesIO()
        Image.new('RGB',(8,8),'red').save(image_bytes,format='PNG')
        response=SimpleNamespace(content=image_bytes.getvalue())
        with tempfile.TemporaryDirectory() as cache, \
             patch('plugins.arkham_horror_lcg.api.fetch_card_json',return_value={
                 'name':'Two-sided card','imagesrc':'front.png','backimagesrc':None,'double_sided':True,
             }), \
             patch('plugins.arkham_horror_lcg.api.request_arkhamdb',return_value=response):
            result=GameImporter(cache).import_game({
                'game':'arkham_horror_lcg','format':'arkhamdb_json',
                'input':{'kind':'text','value':'{"slots":{"01001":1}}'},
            })
        self.assertEqual('success',result['status'])
        self.assertEqual('Two-sided card',result['entries'][0]['name'])
        self.assertTrue(any('has no back image' in warning['message'] for warning in result['warnings']))

    def test_real_lotr_handler_pairs_local_scan_by_card_code(self):
        with tempfile.TemporaryDirectory() as cache, tempfile.TemporaryDirectory() as scans:
            local_back=Path(scans)/'01001.png'
            Image.new('RGB',(8,8),'blue').save(local_back)
            def save_front(index, quantity, code, name, image_url, front_dir, back_dir=None, back_url=None):
                Image.new('RGB',(8,8),'red').save(Path(front_dir)/f'{index}_{code}_{name}_1.png')
            with patch('plugins.lotr_lcg.deck_formats.load_card_catalog',return_value={'01001':{'name':'Aragorn','imagesrc':'fixture.png'}}), \
                 patch('plugins.lotr_lcg.deck_formats.fetch_decklist',return_value={'name':'Deck','heroes':{},'slots':{'01001':1}}), \
                 patch('plugins.lotr_lcg.ringsdb.fetch_card',side_effect=save_front):
                result=GameImporter(cache).import_game({
                    'game':'lotr_lcg','format':'ringsdb_url',
                    'input':{'kind':'url','value':'https://ringsdb.com/decklist/view/123/deck'},
                    'options':{'localBackDir':scans},
                })
            self.assertEqual('success',result['status'])
            entry=result['entries'][0]
            self.assertEqual('Aragorn',entry['name'])
            self.assertEqual(1,entry['qty'])
            self.assertIn('back',entry)
            back_path=Path(url2pathname(urlparse(entry['back']['url']).path))
            with Image.open(back_path) as image:
                self.assertEqual((0,0,255),image.convert('RGB').getpixel((0,0)))

    def test_real_bushiroad_handler_keeps_paired_faces_and_quantity_together(self):
        from plugins.bushiroad.bushiroad import GameTitle
        def save_pair(index, quantity, name, front_url, back_url, front_dir, back_dir):
            for copy in range(1, quantity + 1):
                stem=f'{index}{name}{copy}.png'
                Image.new('RGB',(8,8),'red').save(Path(front_dir)/stem)
                Image.new('RGB',(8,8),'blue').save(Path(back_dir)/stem)
        deck=[{'name':'Twin card','num':'2','img':'front','custom_param':{'is_bothsides':True,'rev_img':'back'}}]
        with tempfile.TemporaryDirectory() as cache, \
             patch('plugins.bushiroad.deck_formats.fetch_decklist',return_value=(GameTitle.WEISS_SCHWARZ,deck)), \
             patch('plugins.bushiroad.deck_formats.resolve_image_url',side_effect=lambda game,url:url), \
             patch('plugins.bushiroad.bushiroad.fetch_card',side_effect=save_pair):
            result=GameImporter(cache).import_game({
                'game':'bushiroad','format':'bushiroad_url',
                'input':{'kind':'url','value':'https://decklog-en.bushiroad.com/view/ABC'},
            })
            self.assertEqual('success',result['status'])
            self.assertEqual(1,len(result['entries']))
            entry=result['entries'][0]
            self.assertEqual(('Twin card',2), (entry['name'],entry['qty']))
            self.assertIn('back',entry)
            with Image.open(Path(url2pathname(urlparse(entry['faces'][0]['url']).path))) as image:
                self.assertEqual((255,0,0),image.convert('RGB').getpixel((0,0)))
            with Image.open(Path(url2pathname(urlparse(entry['back']['url']).path))) as image:
                self.assertEqual((0,0,255),image.convert('RGB').getpixel((0,0)))

    @staticmethod
    def _cache_path():
        import tempfile
        return tempfile.mkdtemp(prefix='gui-import-test-')


if __name__ == '__main__':
    unittest.main()
