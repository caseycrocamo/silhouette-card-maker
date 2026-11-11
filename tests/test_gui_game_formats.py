"""Every advertised plugin format passes its real parser through staged import.

Only remote deck metadata and image handlers are replaced. Network access is
forbidden, and no repository image folder is used.
"""
import base64
import importlib
import struct
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image
from plugins.gui_imports import GAMES, GameImporter, capabilities

TEXT = {
 'altered': {'ajordat': '2 ALT_CORE_B_AX_01_C'},
 'arkham_horror_lcg': {'arkhamdb_json': '{"slots":{"01001":2}}', 'arkhamdb_url': 'https://arkhamdb.com/deck/view/123'},
 'ashes_reborn': {'ashes_share_url': 'https://ashes.live/decks/share/abc', 'ashesdb_share_url': 'https://ashesdb.plaidhatgames.com/decks/share/abc'},
 'bushiroad': {'bushiroad_url': 'https://decklog-en.bushiroad.com/view/ABC'},
 'digimon': {'digimoncardapp': 'BT1-001 Agumon 2', 'digimoncarddev': '2 Agumon BT1-001', 'digimoncardio': '2 Agumon BT1-001', 'digimonmeta': '2 (BT1-001)', 'tts': "['BT1-001']", 'untap': '2 Agumon (DCG) (BT1-001)'},
 'echoes_of_astra': {'astrabuilder_url': 'https://www.astra-builder.com/en/create?deck=123'},
 'elestrals': {'elestrals': 'deck-id'},
 'final_fantasy': {'octgn_xml': '<deck><section><card qty="2">Cloud</card></section></deck>', 'tts': '2 Cloud (1-001H)', 'untap': '2 Cloud (1-001H)'},
 'flesh_and_blood': {'fabrary': '2x Sink Below (red)'},
 'grand_archive': {'omnideck': '2 Sample Card'},
 'gundam': {'deckplanet': '2 Gundam [GD01-001]', 'egman': '2 GD01-001 Gundam', 'exburst': '2 x GD01-001', 'limitless': '2 Gundam GD01-001'},
 'keyforge': {'archon_arcana': 'Dust Pixie\nDust Pixie', 'master_vault_url': 'https://www.keyforgegame.com/deck-details/12345678-1234-1234-1234-123456789abc', 'decks_of_keyforge_url': 'https://decksofkeyforge.com/decks/12345678-1234-1234-1234-123456789abc'},
 'lorcana': {'dreamborn': '2 Mickey Mouse - True Friend *P2-15*'},
 'lotr_lcg': {'ringsdb_url': '123', 'ringsdb_fellowship_url': '123', 'ringsdb_scenario_url': '123', 'hallofbeorn_url': 'https://hallofbeorn.com/LotR/Scenarios/Sample'},
 'netrunner': {'bbcode': '2x [url=https://netrunnerdb.com/en/card/01001]Sure Gamble[/url] [i](Core Set)[/i]', 'jinteki': '2 Sure Gamble', 'markdown': '* 2x [Sure Gamble](https://netrunnerdb.com/en/card/01001) _(Core Set)_', 'plain_text': '2x Sure Gamble (Core Set)', 'text': '2x Sure Gamble (Core Set)'},
 'one_piece': {'egman': '2 OP01-001 Luffy', 'optcgsim': '2xOP01-001'},
 'riftbound': {'piltover_archive': '2 Sample Card', 'pixelborn': base64.b64encode(b'OGN-001-1').decode(), 'tts': 'OGN-001-1'},
 'sorcery_contested_realm': {'curiosa_url': 'https://curiosa.io/decks/abc'},
 'star_wars_unlimited': {'melee': '2 | Luke Skywalker | Jedi Knight', 'picklist': '[ ] [ ] Luke Skywalker | Jedi Knight', 'swudb_json': '{"deck":[{"id":"SOR_001","count":2}]}'},
 'yugioh': {'ydk': '#main\n200\n200\n#extra\n', 'ydke': 'ydke://' + base64.b64encode(struct.pack('<II', 200, 200)).decode() + '!!!'},
}
CASES = [(game['id'], fmt['id'], fmt['inputKind']) for game in capabilities()['games'] for fmt in game['formats']]


def test_fixtures_cover_exactly_the_advertised_formats():
    assert {(game, fmt) for game, formats in TEXT.items() for fmt in formats} == {(game, fmt) for game, fmt, _ in CASES}


@pytest.mark.parametrize('fail', [False, True], ids=['success', 'fetch-failure'])
@pytest.mark.parametrize('game,fmt,kind', CASES, ids=[f'{g}:{f}' for g, f, _ in CASES])
def test_real_format_import(game, fmt, kind, fail, tmp_path, monkeypatch):
    import requests
    def no_network(*args, **kwargs):
        raise AssertionError('Unexpected network request')
    monkeypatch.setattr(requests.sessions.Session, 'request', no_network)
    parser = importlib.import_module(GAMES[game][2])
    api = importlib.import_module(GAMES[game][3])
    if game == 'arkham_horror_lcg':
        monkeypatch.setattr(parser, 'fetch_arkhamdb_deck', lambda *a: {'slots': {'01001': 2}})
    elif game == 'ashes_reborn':
        monkeypatch.setattr(parser, 'fetch_deck_data', lambda *a: [{'name': 'Sample', 'stub': 'sample', 'count': 2}])
    elif game == 'bushiroad':
        monkeypatch.setattr(parser, 'fetch_decklist', lambda *a: (api.GameTitle.WEISS_SCHWARZ, [{'name': 'Sample', 'num': '2', 'img': 'front'}]))
        monkeypatch.setattr(parser, 'resolve_image_url', lambda *a: 'https://fixture/image')
    elif game == 'echoes_of_astra':
        monkeypatch.setattr(parser, 'get_astra_deck', lambda *a: [{'quantity': 2, 'cards': {'name': 'Sample', 'image_url': 'https://fixture/image'}}])
    elif game == 'elestrals':
        monkeypatch.setattr(parser, 'request_elestrals', lambda *a: SimpleNamespace(json=lambda: {'data': {'cards': [{'_id': 'one', 'name': 'Sample', 'images': {'small': 'https://fixture/image'}}], 'deck': {'sections': [{'cards': [{'cardId': 'one', 'count': 2}]}]}}}))
    elif game == 'keyforge':
        monkeypatch.setattr(parser, 'get_deck_card_counts', lambda *a: [('Dust Pixie', 2)])
    elif game == 'lotr_lcg':
        from plugins.lotr_lcg.card_entry import CardEntry
        entries = [CardEntry('01001', 'Aragorn', 'https://fixture/front', 2, 'https://fixture/back')]
        for name, value in {'load_card_catalog': {}, 'fetch_decklist': {'name': 'Fixture'}, 'fetch_fellowship_decks': ('Fixture', [{'name': 'Deck'}]), 'build_deck_entries': entries, 'fetch_all_scenarios': [], 'load_card_image_index': {}, 'fetch_scenario_metadata': {'name': 'Sample'}, 'find_scenario_slug': 'Sample', 'fetch_scenario_entries': entries}.items():
            monkeypatch.setattr(parser, name, lambda *a, result=value, **k: result)
    elif game == 'netrunner':
        monkeypatch.setattr(parser, 'is_valid_set', lambda *a: True)
    elif game == 'riftbound':
        monkeypatch.setattr(parser, 'fetch_card_number', lambda *a: 'OGN-001')
    elif game == 'sorcery_contested_realm':
        monkeypatch.setattr(parser, 'get_curiosa_decklist', lambda *a: [{'quantity': 2, 'card': {'name': 'Sample', 'variants': [{'id': 'one', 'src': 'https://fixture/image'}]}, 'variantId': 'one'}])
    elif game == 'star_wars_unlimited':
        monkeypatch.setattr(parser, 'fetch_name_and_title', lambda *a: ('Luke Skywalker', 'Jedi Knight'))

    calls = []
    def factory(*args):
        directories = [Path(value) for value in args if isinstance(value, str) and Path(value).is_dir()]
        def handler(*card_args, **kwargs):
            calls.append(card_args)
            if fail:
                raise RuntimeError('Fixture fetch failed')
            for directory in directories:
                Image.new('RGB', (8, 8), 'navy').save(directory / f'{len(calls)}.jpg')
        return handler
    if game == 'yugioh':
        def fetch(code, qty, directory):
            calls.append((code, qty))
            if fail:
                raise RuntimeError('Fixture fetch failed')
            Image.new('RGB', (8, 8), 'navy').save(Path(directory) / 'card.jpg')
        monkeypatch.setattr(api, 'fetch_card_art', fetch)
    else:
        monkeypatch.setattr(api, 'get_handle_card', factory)
    value = TEXT[game][fmt]
    if kind == 'file':
        source = tmp_path / ('デッキ.ydk' if game == 'yugioh' else 'デッキ.txt')
        source.write_text(value, encoding='utf8')
        value = str(source)
    importer = GameImporter(tmp_path / 'cache')
    request = {'game': game, 'format': fmt, 'input': {'kind': kind, 'value': value}}
    if fail:
        try:
            result = importer.import_game(request)
        except RuntimeError as error:
            assert 'Fixture fetch failed' in str(error)
        else:
            assert result['status'] == 'failure', result
            assert result['errors'] and not result['entries']
        assert not list((tmp_path / 'cache').iterdir())
        return
    result = importer.import_game(request)
    assert result['status'] == 'success', result
    assert len(calls) == len(result['entries']) == 1
    expected = 1 if (game == 'digimon' and fmt == 'tts') or (game == 'riftbound' and fmt in {'tts', 'pixelborn'}) else 2
    assert result['entries'][0]['qty'] == expected, result
    with Image.open(tmp_path / 'cache' / (result['entries'][0]['cacheId'] + '.png')) as image:
        assert image.format == 'PNG'
    if kind == 'file':
        assert source.read_text(encoding='utf8') == TEXT[game][fmt]
