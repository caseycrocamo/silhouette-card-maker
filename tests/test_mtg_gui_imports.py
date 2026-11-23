import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import pytest
import requests
from PIL import Image
from plugins.gui_adapters.mtg import MtgImporter
from plugins.mtg import deck_formats

@pytest.fixture
def importer(tmp_path):
    return MtgImporter(tmp_path)

def png(color='red'):
    data=io.BytesIO(); Image.new('RGB',(8,8),color).save(data,'PNG'); return data.getvalue()

@pytest.mark.parametrize('fmt,text',[
    ('simple','Lightning Bolt'), ('mtga','Deck\n2 Lightning Bolt (M11) 146\nSideboard\n1 Island'),
    ('mtgo','2 Lightning Bolt\nSIDEBOARD:\n1 Island'),
    ('archidekt','2x Lightning Bolt (m11) 146 [Burn]'),
    ('deckstats','2 [M11#146] Lightning Bolt'), ('moxfield','2 Lightning Bolt (M11) 146 *F*'),
    ('cubecobra_csv','name,Set,Collector Number\nLightning Bolt,M11,146\nLightning Bolt,M11,146'),
    ('scryfall_json','{"entries":{"main":[{"count":2,"card_digest":{"name":"Lightning Bolt","set":"m11","collector_number":"146"}}]}}'),
    ('mpcfill_xml','<order><details><quantity>2</quantity></details><fronts><card><id>front</id><name>Bolt.png</name><slots>0,1</slots></card></fronts><backs><card><id>back</id><name>Back.png</name><slots>1</slots></card></backs></order>'),
])
def test_real_cli_formats_parse(importer,fmt,text):
    rows,errors=importer.parse(text,fmt)
    assert rows and not errors
    if fmt=='mpcfill_xml':
        assert [row['slot'] for row in rows]==[1,2]
        assert rows[0]['backId'] is None and rows[1]['backId']=='back'
    elif fmt!='simple': assert rows[0]['qty']==2

def test_url_uses_cli_parser(importer):
    cards=[SimpleNamespace(name='Bolt',extension='m11',number='146',quantity=3)]
    with patch.object(deck_formats.mtg_parser.MoxfieldDeckParser,'parse_deck',return_value=cards):
        rows,errors=importer.parse('https://moxfield.com/decks/test','url')
    assert rows[0]['qty']==3 and not errors

def test_unsupported_url_reports_failure(importer):
    with patch.object(deck_formats.cloudscraper,'create_scraper') as scraper:
        rows,errors=importer.parse('https://invalid.test/deck','url')
    assert not rows and errors
    scraper.assert_not_called()

def test_custom_front_and_back_decode_to_png_without_false_identity(importer):
    row={'id':'1','name':'Custom','provenance':'custom','frontUrl':'https://art.test/front','backUrl':'https://art.test/back'}
    response=SimpleNamespace(content=png(),raise_for_status=lambda:None)
    with patch.object(importer.http,'get',return_value=response):
        cards,tokens=importer.resolve(row,{})
    card=cards[0]
    assert card['custom'] and card['paired'] and 'rawCard' not in card and not tokens
    assert len(card['faces'])==2
    assert all((importer.root/(face['cacheId']+'.png')).read_bytes().startswith(b'\x89PNG') for face in card['faces'])

def test_retry_only_fetches_failed_rows_and_does_not_duplicate_tokens(importer):
    request={'format':'mtgo','input':{'kind':'text','value':'2 Bolt\n1 Island'},'options':{'tokens':True}}
    attempts=[]
    def resolve(row, options):
        attempts.append(row['name'])
        if row['name']=='Island' and attempts.count('Island')==1: raise ValueError('offline')
        return [{'id':row['id'],'name':row['name'],'faces':[]}],[{'id':'token','name':'Token','faces':[]}]
    with patch.object(importer,'resolve',side_effect=resolve):
        first=importer.import_game(request); second=importer.import_game(request)
    assert attempts==['Bolt','Island','Island']
    assert any(entry.get('error') for entry in first['entries'])
    assert len(second['entries'])==3
    assert second['entries'][-1]['qty']==3

def test_unicode_file_and_original_source(importer,tmp_path):
    source=tmp_path/'déck.csv'; source.write_text('name,Set\nÉowyn,ltr',encoding='utf-8')
    with patch.object(importer,'resolve',return_value=([{'id':'one','faces':[]}],[])):
        result=importer.import_game({'format':'cubecobra_csv','input':{'kind':'file','value':str(source)}})
    assert result['entries'][0]['name']=='Éowyn'
    assert source.read_text(encoding='utf-8')=='name,Set\nÉowyn,ltr'

def test_bad_documents_and_empty_decks(importer):
    for fmt,text in [('scryfall_json','{'),('mpcfill_xml','<'),('cubecobra_csv','bad\nrow')]:
        with pytest.raises(Exception): importer.parse(text,fmt)
    assert importer.parse('', 'mtgo')[1]

def test_mpcfill_import_preserves_duplicate_slot_order_and_custom_backs(importer):
    text='<order><details><quantity>3</quantity></details><fronts><card><id>same</id><name>Bolt.png</name><slots>0,2</slots></card><card><id>other</id><name>Island.png</name><slots>1</slots></card></fronts><backs><card><id>reverse</id><name>Back.png</name><slots>2</slots></card></backs></order>'
    with patch('plugins.gui_adapters.mtg.mpcfill.get_cached_image',return_value=png()):
        result=importer.import_game({'format':'mpcfill_xml','input':{'kind':'text','value':text}})
    entries=result['entries']
    assert [entry['name'] for entry in entries]==['Bolt','Island','Bolt']
    assert [entry['qty'] for entry in entries]==[1,1,1]
    assert [len(entry['printing']['faces']) for entry in entries]==[1,1,2]
    assert all(entry['printing']['custom'] for entry in entries)

def test_failed_back_rolls_back_row_images_and_preserves_successful_cache(importer):
    text=('name,Set,image URL,image Back URL\n'
          'Earlier,ltr,https://art.test/earlier,\n'
          'Paired,ltr,https://art.test/front,https://art.test/back\n')
    request={'format':'cubecobra_csv','input':{'kind':'text','value':text}}
    downloads=[]
    def download(url,**_kwargs):
        downloads.append(url)
        if url.endswith('/back'): raise requests.ConnectionError('Back is offline')
        return SimpleNamespace(content=png(),raise_for_status=lambda:None)
    with patch.object(importer.http,'get',side_effect=download):
        first=importer.import_game(request)
        earlier=first['entries'][0]['printing']['faces'][0]['cacheId']
        assert 'Back is offline' in first['entries'][1]['error']
        assert {path.stem for path in importer.root.glob('*.png')}=={earlier}
        second=importer.import_game(request)
    assert second['entries'][0]['printing']['faces'][0]['cacheId']==earlier
    assert {path.stem for path in importer.root.glob('*.png')}=={earlier}
    assert downloads.count('https://art.test/earlier')==1
    assert downloads.count('https://art.test/front')==2


@pytest.mark.parametrize('fmt', sorted(deck_formats.TEXT_FORMATS))
def test_all_text_aliases_accept_the_same_mixed_list(importer, fmt):
    text = """About
Name Mixed export
Deck
Lightning Bolt
2x Lightning Bolt (M11) 146
3 Lightning Bolt
4x Lightning Bolt (m11) 146★ *F* [Burn] ^Have,#37d67a^
5 [M11#146-1] Lightning Bolt #!Commander
Sideboard:
1 Fire // Ice (MH2) 290
// Comment
"""
    rows, errors = importer.parse(text, fmt)
    assert not errors
    assert [(r['name'], r['qty'], r['setCode'], r['number']) for r in rows] == [
        ('Lightning Bolt', 1, '', ''), ('Lightning Bolt', 2, 'M11', '146'),
        ('Lightning Bolt', 3, '', ''), ('Lightning Bolt', 4, 'm11', '146★'),
        ('Lightning Bolt', 5, 'M11', '146-1'), ('Fire // Ice', 1, 'MH2', '290'),
    ]


def test_invalid_text_rows_keep_source_lines_and_valid_cards(importer):
    rows, errors = importer.parse('Deck\n0 Bolt\n1 Island\n2x\n9007199254740992 Plains', 'default')
    assert [(r['name'], r['qty']) for r in rows] == [('Island', 1)]
    assert [error['line'] for error in errors] == [2, 4, 5]


def test_card_names_are_not_mistaken_for_arena_deck_metadata(importer):
    rows, errors = importer.parse('About\nName My export\n\nDeck\nName Dropping\nB.F.M. (Big Furry Monster)', 'default')
    assert not errors
    assert [row['name'] for row in rows] == ['Name Dropping', 'B.F.M. (Big Furry Monster)']


@pytest.mark.parametrize('url,reader_class,document,export', [
    ('https://moxfield.com/decks/test', deck_formats.mtg_parser.MoxfieldDeckParser,
     {'commanders': {}, 'companions': {}, 'mainboard': {
         'Lightning Bolt': {'quantity': 2, 'card': {'set': 'm11', 'cn': '146★'}}}},
     '2 Lightning Bolt (m11) 146★ *F*'),
    ('https://archidekt.com/decks/123', deck_formats.mtg_parser.ArchidektDeckParser,
     {'categories': [{'name': 'Main', 'includedInDeck': True}], 'cards': [{
         'quantity': 2, 'categories': ['Main'], 'card': {'oracleCard': {'name': 'Lightning Bolt'},
         'edition': {'editioncode': 'm11'}, 'collectorNumber': '146★'}}]},
     '2x Lightning Bolt (m11) 146★ [Main]'),
    ('https://deckstats.net/decks/123/456-test/', deck_formats.mtg_parser.DeckstatsDeckParser,
     {'props': {'entries': [{'name': 'Lightning Bolt', 'amount': 2}]}},
     '2 Lightning Bolt'),
])
def test_url_fetch_reuses_site_reader_then_shared_text_parser(importer, url, reader_class, document, export):
    import json
    response = SimpleNamespace(json=lambda: document, text=(
        '<script data-page="app" type="application/json">' + json.dumps(document) + '</script>'))
    client = MagicMock()
    client.get.return_value = response
    original = reader_class._parse_deck
    with patch.object(deck_formats.cloudscraper, 'create_scraper', return_value=client), \
         patch.object(reader_class, '_parse_deck', autospec=True, side_effect=original) as site_reader, \
         patch.object(deck_formats, 'parse_card_line', wraps=deck_formats.parse_card_line) as text_reader:
        rows, errors = importer.parse(url, 'url')
    assert not errors
    client.get.assert_called_once()
    site_reader.assert_called_once()
    assert text_reader.call_count == 1
    pasted, paste_errors = importer.parse(export, 'default')
    assert not paste_errors and rows == pasted


def test_url_late_failure_retains_imported_cards(importer):
    def cards():
        yield SimpleNamespace(name='Lightning Bolt', extension='m11', number='146', quantity=2)
        raise ValueError('Bad second site record')
    with patch.object(deck_formats.mtg_parser.MoxfieldDeckParser, 'parse_deck', return_value=cards()):
        rows, errors = importer.parse('https://moxfield.com/decks/test', 'url')
    assert len(rows) == 1 and rows[0]['qty'] == 2
    assert errors and 'Bad second site record' in errors[0]['message']


@pytest.mark.parametrize('url,reader_class', [
    ('https://aetherhub.com/Deck/test', deck_formats.mtg_parser.AetherhubDeckParser),
    ('https://archidekt.com/decks/123', deck_formats.mtg_parser.ArchidektDeckParser),
    ('https://deckstats.net/decks/123/456-test/', deck_formats.mtg_parser.DeckstatsDeckParser),
    ('https://moxfield.com/decks/test', deck_formats.mtg_parser.MoxfieldDeckParser),
    ('https://mtggoldfish.com/deck/123', deck_formats.mtg_parser.MtggoldfishDeckParser),
    ('https://mtgjson.com/api/v5/decks/test.json', deck_formats.mtg_parser.MtgjsonDeckParser),
    ('https://scryfall.com/@user/decks/00000000-0000-0000-0000-000000000000', deck_formats.mtg_parser.ScryfallDeckParser),
    ('https://tappedout.net/mtg-decks/test/', deck_formats.mtg_parser.TappedoutDeckParser),
    ('https://tcgplayer.com/magic-the-gathering/deck/test/123', deck_formats.mtg_parser.TcgplayerDeckParser),
])
def test_each_url_uses_its_site_reader_after_download(importer, url, reader_class):
    document = {'fixture': 'downloaded document'}
    cards = [SimpleNamespace(name='Lightning Bolt', extension='m11', number='146', quantity=2)]
    with patch.object(deck_formats.cloudscraper, 'create_scraper'), \
         patch.object(reader_class, '_download_deck', return_value=document) as download, \
         patch.object(reader_class, '_parse_deck', return_value=cards) as reader:
        rows, errors = importer.parse(url, 'url')
    assert not errors and rows[0]['name'] == 'Lightning Bolt'
    download.assert_called_once()
    reader.assert_called_once_with(document)



def test_parse_only_returns_rows_before_downloading_images(importer):
    request = {'format': 'url', 'parseOnly': True,
               'input': {'kind': 'url', 'value': 'https://moxfield.com/decks/test'}}
    cards = [SimpleNamespace(name='Lightning Bolt', extension='m11', number='146', quantity=2)]
    with patch.object(deck_formats.mtg_parser.MoxfieldDeckParser, 'parse_deck', return_value=cards), \
         patch.object(importer, 'resolve', side_effect=AssertionError('Must not download images')):
        result = importer.import_game(request)
    assert not result['errors']
    assert result['entries'][0]['name'] == 'Lightning Bolt'
    assert 'printing' not in result['entries'][0]


def test_failed_url_fetch_is_not_cached_on_retry(importer):
    request = {'format': 'url', 'parseOnly': True,
               'input': {'kind': 'url', 'value': 'https://moxfield.com/decks/test'}}
    cards = [SimpleNamespace(name='Lightning Bolt', extension='m11', number='146', quantity=2)]
    with patch.object(deck_formats.mtg_parser.MoxfieldDeckParser, 'parse_deck',
                      side_effect=[requests.Timeout('Site timeout'), cards]) as fetch:
        first = importer.import_game(request)
        second = importer.import_game(request)
    assert first['errors'] and not first['entries']
    assert not second['errors'] and second['entries']
    assert fetch.call_count == 2


@pytest.mark.parametrize('double_sided', [False, True])
def test_card_metadata_image_urls_avoid_extra_api_redirects(importer, double_sided):
    raw = {'id': 'fixture', 'name': 'Fixture card', 'set': 'm11', 'collector_number': '146',
           'lang': 'en', 'layout': 'transform' if double_sided else 'normal'}
    if double_sided:
        raw['card_faces'] = [{'image_uris': {'png': 'https://cards.scryfall.io/front.png'}},
                             {'image_uris': {'png': 'https://cards.scryfall.io/back.png'}}]
    else:
        raw['image_uris'] = {'png': 'https://cards.scryfall.io/front.png'}
    def fetch(*args, **kwargs):
        kwargs['art_handler'](raw, 1, 1, 'Fixturecard', 'm11', '146', raw['layout'])
    response = SimpleNamespace(content=png(), raise_for_status=lambda: None)
    with patch('plugins.gui_adapters.mtg.scryfall.fetch_card', side_effect=fetch), \
         patch('plugins.gui_adapters.mtg.scryfall.fetch_card_art') as legacy_images, \
         patch.object(importer.http, 'get', return_value=response) as get:
        result = importer.import_game({'format': 'default', 'input': {'kind': 'text', 'value': 'Fixture card'}})
    assert not result['errors']
    assert len(result['entries'][0]['printing']['faces']) == (2 if double_sided else 1)
    assert result['entries'][0]['printing']['paired'] == double_sided
    assert get.call_count == (2 if double_sided else 1)
    assert get.call_args.kwargs['timeout'] == (5, 30)
    legacy_images.assert_not_called()


def test_url_requests_have_timeouts_and_check_http_errors(importer):
    client = requests.Session()
    response = MagicMock()
    response.json.return_value = {'commanders': {}, 'companions': {}, 'mainboard': {
        'Lightning Bolt': {'quantity': 1, 'card': {'set': 'm11', 'cn': '146'}}}}
    with patch.object(client, 'request', return_value=response) as request, \
         patch.object(deck_formats.cloudscraper, 'create_scraper', return_value=client):
        rows, errors = importer.parse('https://moxfield.com/decks/test', 'url')
    assert rows and not errors
    assert request.call_args.kwargs['timeout'] == (5, 30)
    response.raise_for_status.assert_called_once()



def test_url_to_simple_keeps_a_large_deck_in_one_cache_job(importer):
    rows = [{'id': f'row-{i}', 'name': f'Card {i}', 'qty': 1,
             'setCode': 'M11', 'number': str(i), 'provenance': 'scryfall'} for i in range(1, 96)]
    parse = importer.parse
    def read(text, fmt, options=None):
        return (rows, []) if fmt == 'url' else parse(text, fmt)
    source = 'https://archidekt.com/decks/28135484/example'
    with patch.object(importer, 'parse', side_effect=read), \
         patch.object(importer, 'resolve', return_value=([{'id': 'card', 'faces': []}], [])) as resolve:
        metadata = importer.import_game({'format': 'url', 'parseOnly': True,
                                         'input': {'kind': 'url', 'value': source}})
        assert resolve.call_count == 0
        text = '\n'.join(f"{row['name']} ({row['setCode']}) {row['number']}" for row in metadata['entries'])
        request = {'format': 'default', 'input': {'kind': 'text', 'value': text}}
        first = importer.import_game(request)
        second = importer.import_game(request)
    assert len(first['entries']) == len(second['entries']) == 95
    assert resolve.call_count == 95  # The second load reuses all 95 cached cards.
    assert len(importer.jobs) == 2  # URL metadata and one complete Simple deck.


def test_shared_deck_import_streams_counts_and_card_images_before_finishing(importer):
    updates = []
    def resolve(row, options):
        assert len(updates) == (1 if row['name'] == 'Bolt' else 2)
        return [{'id': row['name'], 'name': row['name'], 'faces': []}], []
    with patch.object(importer, 'resolve', side_effect=resolve):
        result = importer.import_game({'format': 'default', 'input': {'kind': 'text', 'value': '2 Bolt\nIsland'}},
                                      on_progress=updates.append)
    assert updates[0] == {'reset': True, 'completed': 0, 'total': 2, 'entries': [], 'errors': []}
    assert [update['completed'] for update in updates] == [0, 1, 2]
    assert updates[1]['entries'][0]['printing']['id'] == 'Bolt'
    assert updates[2]['entries'][0]['printing']['id'] == 'Island'
    assert len(result['entries']) == 2
    assert len(importer.jobs) == 1
