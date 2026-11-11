import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
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
    with patch.object(deck_formats.mtg_parser,'parse_deck',return_value=cards):
        rows,errors=importer.parse('https://moxfield.com/decks/test','url')
    assert rows[0]['qty']==3 and not errors

def test_unsupported_url_reports_failure(importer):
    with patch.object(deck_formats.mtg_parser,'parse_deck',return_value=None):
        rows,errors=importer.parse('https://invalid.test/deck','url')
    assert not rows and errors

def test_custom_front_and_back_decode_to_png_without_false_identity(importer):
    row={'id':'1','name':'Custom','provenance':'custom','frontUrl':'https://art.test/front','backUrl':'https://art.test/back'}
    response=SimpleNamespace(content=png(),raise_for_status=lambda:None)
    with patch('plugins.gui_adapters.mtg.requests.get',return_value=response):
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
    assert source.read_text()=='name,Set\nÉowyn,ltr'

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
    with patch('plugins.gui_adapters.mtg.requests.get',side_effect=download):
        first=importer.import_game(request)
        earlier=first['entries'][0]['printing']['faces'][0]['cacheId']
        assert 'Back is offline' in first['entries'][1]['error']
        assert {path.stem for path in importer.root.glob('*.png')}=={earlier}
        second=importer.import_game(request)
    assert second['entries'][0]['printing']['faces'][0]['cacheId']==earlier
    assert {path.stem for path in importer.root.glob('*.png')}=={earlier}
    assert downloads.count('https://art.test/earlier')==1
    assert downloads.count('https://art.test/front')==2
