"""URL section choices select documents before the existing site readers run."""
import itertools
from unittest.mock import patch

import pytest
import mtg_parser

from plugins.mtg.url_sections import read_sections
from plugins.gui_adapters.mtg import MtgImporter


def arch_card(name, category, number):
    return {'quantity': number, 'categories': [category], 'card': {
        'oracleCard': {'name': name, 'layout': 'token' if name == 'Token' else 'normal'},
        'edition': {'editioncode': 'm11'}, 'collectorNumber': str(number)}}


def arch_document():
    return {'categories': [{'name': name, 'includedInDeck': name == 'Main'}
                           for name in ['Main', 'Sideboard', 'Maybeboard', 'Tokens']],
            'cards': [arch_card(name, board, number) for number, (name, board) in enumerate(
                [('Main', 'Main'), ('Side', 'Sideboard'), ('Maybe', 'Maybeboard'), ('Token', 'Tokens')], 1)]}


def fixtures():
    boards = [('Main', 'main'), ('Side', 'sideboard'), ('Maybe', 'maybeboard'), ('Token', 'tokens')]
    mox = {'commanders': {}, 'companions': {}}
    for number, (name, board) in enumerate(boards, 1):
        mox['mainboard' if board == 'main' else board] = {name: {'quantity': number, 'card': {
            'set': 'm11', 'cn': str(number), 'layout': 'token' if name == 'Token' else 'normal'}}}
    mtgjson = {'data': {'commander': []}}
    for number, (name, board) in enumerate(boards, 1):
        mtgjson['data'][{'main': 'mainBoard', 'sideboard': 'sideBoard', 'maybeboard': 'maybeBoard', 'tokens': 'tokens'}[board]] = [
            {'name': name, 'count': number, 'setCode': 'm11'}]
    csv = 'name,count,set_code,collector_number,section\n' + ''.join(
        f'{name},{number},m11,{number},{board}\n' for number, (name, board) in enumerate(boards, 1))
    deckstats = {'props': {'entries': [{'name': name, 'amount': number, 'section': board}
                                      for number, (name, board) in enumerate(boards, 1)]}}
    aether = {'convertedDeck': [entry for number, (name, board) in enumerate(boards, 1) for entry in [
        {'name': board, 'quantity': 0}, {'name': name, 'quantity': number, 'set': 'm11', 'number': str(number)}]]}
    tcg = {'result': {'deck': {'subDecks': {'commandzone': []}}, 'cards': {}}}
    for number, (name, board) in enumerate(boards, 1):
        tcg['result']['deck']['subDecks']['maindeck' if board == 'main' else board] = [{'cardID': number, 'quantity': number}]
        tcg['result']['cards'][str(number)] = {'name': name, 'set': 'm11'}
    goldfish = '<table class="deck-view-deck-table">' + ''.join(
        f'<tr class="deck-category-header"><td>{board}</td></tr><tr><td>{number}</td><td><a data-card-id="[M11]">{name}</a></td></tr>'
        for number, (name, board) in enumerate(boards, 1)) + '</table>'
    tapped = '<div class="board-container">' + ''.join(
        f'<h3>{board} ({number})</h3><a class="qty board" data-name="{name}" data-qty="{number}"></a>'
        f'<a class="card-hover" data-name="{name}" data-url="card/{number}"></a>'
        for number, (name, board) in enumerate(boards, 1)) + '</div>'
    return [(mtg_parser.ArchidektDeckParser, arch_document()), (mtg_parser.MoxfieldDeckParser, mox),
            (mtg_parser.ScryfallDeckParser, csv), (mtg_parser.MtgjsonDeckParser, mtgjson),
            (mtg_parser.DeckstatsDeckParser, deckstats), (mtg_parser.AetherhubDeckParser, aether),
            (mtg_parser.TcgplayerDeckParser, tcg), (mtg_parser.MtggoldfishDeckParser, goldfish),
            (mtg_parser.TappedoutDeckParser, tapped)]


@pytest.mark.parametrize('reader_class,document', fixtures(), ids=lambda value: value.__name__ if isinstance(value, type) else None)
@pytest.mark.parametrize('side,maybe,tokens', list(itertools.product([False, True], repeat=3)))
def test_all_section_combinations_use_site_readers(reader_class, document, side, maybe, tokens):
    reader = reader_class()
    options = {'include_sideboard': side, 'include_maybeboard': maybe, 'tokens': tokens}
    cards = list(read_sections(reader, reader._parse_deck, document, options))
    expected = {'Main': 1}
    for enabled, name, quantity in [(side, 'Side', 2), (maybe, 'Maybe', 3), (tokens, 'Token', 4)]:
        if enabled:
            expected[name] = quantity
    assert {card.name: card.quantity for card in cards} == expected


def test_archidekt_maybe_tag_overrides_other_included_categories():
    reader = mtg_parser.ArchidektDeckParser()
    document = arch_document()
    document['cards'][0]['categories'].append('Maybeboard')
    assert list(read_sections(reader, reader._parse_deck, document, {})) == []
    assert {card.name for card in read_sections(reader, reader._parse_deck, document, {'include_maybeboard': True})} == {'Main', 'Maybe'}


def test_archidekt_token_strategy_category_does_not_exclude_token_makers():
    reader = mtg_parser.ArchidektDeckParser()
    document = arch_document()
    document['categories'][-1]['includedInDeck'] = True
    document['cards'] = [arch_card('Alela, Cunning Conqueror', 'Tokens', 1), arch_card('Token', 'Tokens', 4)]
    assert [card.name for card in read_sections(reader, reader._parse_deck, document, {})] == ['Alela, Cunning Conqueror']


@pytest.mark.parametrize('side,maybe', list(itertools.product([False, True], repeat=2)))
def test_archidekt_overlapping_boards_use_only_explicit_board_choices(side, maybe):
    reader = mtg_parser.ArchidektDeckParser()
    document = arch_document()
    card = arch_card('Circle of Power', 'Maybeboard', 1)
    card['categories'] += ['Sideboard', 'Main', 'Main']
    document['cards'] = [card]
    cards = list(read_sections(reader, reader._parse_deck, document,
                              {'include_sideboard': side, 'include_maybeboard': maybe}))
    assert bool(cards) == (side or maybe)


def test_import_options_reach_url_reader_and_cache_separately(tmp_path):
    importer = MtgImporter(tmp_path)
    request = {'format': 'url', 'parseOnly': True,
               'input': {'kind': 'url', 'value': 'https://archidekt.com/decks/123'}}
    with patch.object(mtg_parser.ArchidektDeckParser, '_download_deck', return_value=arch_document()), \
         patch.object(importer, 'resolve', side_effect=AssertionError('Metadata must not fetch images')):
        main = importer.import_game(request)
        all_boards = importer.import_game({**request, 'options': {
            'include_maybeboard': True, 'include_sideboard': True, 'tokens': True}})
    assert [row['name'] for row in main['entries']] == ['Main']
    assert {row['name'] for row in all_boards['entries']} == {'Main', 'Side', 'Maybe', 'Token'}
    assert len(importer.jobs) == 2


def test_explicit_source_tokens_do_not_duplicate_generated_tokens(tmp_path):
    importer = MtgImporter(tmp_path)
    main = {'id': 'main', 'faces': [], 'rawCard': {'layout': 'normal'}}
    token = {'id': 'token', 'name': 'Token', 'faces': [], 'rawCard': {'layout': 'token'}}
    with patch.object(importer, 'resolve', side_effect=[([main], [token]), ([token], [])]):
        result = importer.import_game({'format': 'default', 'options': {'tokens': True},
                                       'input': {'kind': 'text', 'value': 'Main\n3 Token'}})
    assert len(result['entries']) == 2
    assert result['entries'][1]['qty'] == 3
