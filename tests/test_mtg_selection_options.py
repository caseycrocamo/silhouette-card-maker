from pathlib import Path
from unittest.mock import patch
import pytest
from PIL import Image
from plugins.mtg.selection_options import validate_options, BOOLEAN_OPTIONS
from plugins.gui_adapters.mtg import MtgImporter
from plugins.mtg import scryfall

@pytest.mark.parametrize('key',BOOLEAN_OPTIONS)
def test_each_boolean_option(key):
    assert validate_options({key:True})[key]
    with pytest.raises(ValueError): validate_options({key:'yes'})

def test_order_and_language_validation():
    value=validate_options({'prefer_set':['LTR','m11','ltr'],'prefer_lang':['jp','en']})
    assert value['prefer_set']==['ltr','m11'] and value['prefer_lang']==['jp','en']
    for options in [{'prefer_ub':True,'ignore_ub':True},{'prefer_lang':['xx']},{'extra':True}]:
        with pytest.raises(ValueError): validate_options(options)

def test_gui_forwards_all_cli_options_and_collects_token(tmp_path):
    importer=MtgImporter(tmp_path)
    options=validate_options({'tokens':True,'prefer_lang':['jp','en'],'prefer_set':['m11'],'ignore_set':['lea'],
                              'prefer_older_sets':True,'prefer_showcase':True,'prefer_extra_art':True,'prefer_ub':True,
                              'ignore_set_and_collector_number':True})
    calls=[]
    def fetch(*args,art_handler):
        calls.append(args)
        art_handler({'id':'card','name':'Bolt','set':'m11','collector_number':'146'},1,2,'Bolt','m11','146','normal')
        art_handler({'id':'token','name':'Token','set':'tm11','collector_number':'1'},1,2,'Token_token','tm11','1','normal')
    def art(index,quantity,clean,code,number,layout,all_parts,name,langs,front,back):
        Image.new('RGB',(8,8),'red').save(Path(front)/'image.png')
    with patch.object(scryfall,'fetch_card',side_effect=fetch), patch.object(scryfall,'fetch_card_art',side_effect=art):
        cards,tokens=importer.resolve({'id':'row-1','name':'Bolt','setCode':'lea','number':'1','qty':2,'provenance':'scryfall'},options)
    assert calls[0][4] is True and calls[0][6:9]==(True,['m11'],['lea'])
    assert [lang.value for lang in calls[0][13]]==['jp','en']
    assert calls[0][14] is True
    assert cards[0]['rawCard']['id']=='card'
    assert tokens[0]['token'] and tokens[0]['parentId']=='row-1'

def test_actual_cli_selector_exact_printing_and_ignore_precedence():
    from types import SimpleNamespace
    card={'id':'exact','name':'Bolt','set':'lea','collector_number':'1','layout':'normal'}
    calls=[]; observed=[]
    def request(url,params=None):
        calls.append((url,params))
        return SimpleNamespace(json=lambda:card)
    args=[1,2,'lea','1',False,'Bolt',False,[],[],False,False,False,False,None,False,'','']
    with patch.object(scryfall,'request_scryfall',side_effect=request):
        scryfall.fetch_card(*args,art_handler=lambda metadata,*a,**kw:observed.append(metadata))
        assert calls[0][0].endswith('/lea/1')
        args[4]=True
        scryfall.fetch_card(*args,art_handler=lambda metadata,*a,**kw:observed.append(metadata))
    assert calls[1]==('https://api.scryfall.com/cards/named',{'exact':'Bolt'})
    assert observed[0]['id']=='exact'

def test_real_cli_and_gui_token_copy_counts_match(tmp_path):
    from types import SimpleNamespace
    parent={'id':'parent','name':'Maker','set':'abc','collector_number':'1','layout':'normal',
            'all_parts':[{'component':'token','name':'Soldier','uri':'https://api.scryfall.com/cards/token'}]}
    token={'id':'token','name':'Soldier','set':'tabc','collector_number':'2','layout':'normal'}
    def request(url,params=None):
        return SimpleNamespace(json=lambda:token if url.endswith('/token') else parent)
    args=(1,3,'abc','1',False,'Maker',False,[],[],False,False,False,False,None,True,'front','back')
    cli=[]
    with patch.object(scryfall,'request_scryfall',side_effect=request), patch.object(scryfall,'fetch_card_art',side_effect=lambda *a,**kw:cli.append(a)):
        scryfall.fetch_card(*args)
    assert [call[1] for call in cli]==[3,3]
    def save(index,quantity,clean,code,number,layout,all_parts,name,langs,front,back):
        assert quantity==1 # Cache one image; expand physical copies on export.
        Image.new('RGB',(8,8),'red').save(Path(front)/'image.png')
    importer=MtgImporter(tmp_path)
    with patch.object(scryfall,'request_scryfall',side_effect=request), patch.object(scryfall,'fetch_card_art',side_effect=save):
        result=importer.import_game({'format':'mtga','input':{'kind':'text','value':'3 Maker (abc) 1'},'options':{'tokens':True}})
    assert [entry['qty'] for entry in result['entries']]==[call[1] for call in cli]
    assert result['entries'][1]['token']
