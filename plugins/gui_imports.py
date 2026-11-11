"""Staged GUI imports for the non-MTG/Pokémon game plugins."""
from __future__ import annotations

import importlib
import json
from pathlib import Path
import tempfile
import uuid
import re
import io
from PIL import Image
import contextlib
from plugins.gui_game_metadata import GAMES as GAME_METADATA

GAMES = {
    'altered': ('Altered', 'text', 'plugins.altered.deck_formats', 'plugins.altered.altered', ('front',)),
    'arkham_horror_lcg': ('Arkham Horror LCG', 'text', 'plugins.arkham_horror_lcg.deck_formats', 'plugins.arkham_horror_lcg.api', ('front','back')),
    'ashes_reborn': ('Ashes Reborn', 'url', 'plugins.ashes_reborn.deck_formats', 'plugins.ashes_reborn.ashes', ('front',)),
    'bushiroad': ('Bushiroad', 'url', 'plugins.bushiroad.deck_formats', 'plugins.bushiroad.bushiroad', ('front','back')),
    'digimon': ('Digimon', 'text', 'plugins.digimon.deck_formats', 'plugins.digimon.digimoncard', ('front',)),
    'echoes_of_astra': ('Echoes of Astra', 'url', 'plugins.echoes_of_astra.deck_formats', 'plugins.echoes_of_astra.api', ('front',)),
    'elestrals': ('Elestrals', 'file', 'plugins.elestrals.deck_formats', 'plugins.elestrals.elestrals', ('front',)),
    'final_fantasy': ('Final Fantasy TCG', 'text', 'plugins.final_fantasy.deck_formats', 'plugins.final_fantasy.fftcg', ('front',)),
    'flesh_and_blood': ('Flesh and Blood', 'text', 'plugins.flesh_and_blood.deck_formats', 'plugins.flesh_and_blood.fabtcg', ('front',)),
    'grand_archive': ('Grand Archive', 'text', 'plugins.grand_archive.deck_formats', 'plugins.grand_archive.gatcg', ('front',)),
    'gundam': ('Gundam', 'text', 'plugins.gundam.deck_formats', 'plugins.gundam.gundam', ('front',)),
    'keyforge': ('KeyForge', 'text', 'plugins.keyforge.deck_formats', 'plugins.keyforge.archonarcana', ('front',)),
    'lorcana': ('Disney Lorcana', 'text', 'plugins.lorcana.deck_formats', 'plugins.lorcana.lorcast', ('front',)),
    'lotr_lcg': ('Lord of the Rings LCG', 'url', 'plugins.lotr_lcg.deck_formats', 'plugins.lotr_lcg.ringsdb', ('front','back')),
    'netrunner': ('Netrunner', 'text', 'plugins.netrunner.deck_formats', 'plugins.netrunner.api', ('front',)),
    'one_piece': ('One Piece', 'text', 'plugins.one_piece.deck_formats', 'plugins.one_piece.one_piece', ('front',)),
    'riftbound': ('Riftbound', 'text', 'plugins.riftbound.deck_formats', 'plugins.riftbound.api', ('front',)),
    'sorcery_contested_realm': ('Sorcery: Contested Realm', 'url', 'plugins.sorcery_contested_realm.deck_formats', 'plugins.sorcery_contested_realm.curiosa', ('front',)),
    'star_wars_unlimited': ('Star Wars Unlimited', 'text', 'plugins.star_wars_unlimited.deck_formats', 'plugins.star_wars_unlimited.swudb', ('front','back')),
    'yugioh': ('Yu-Gi-Oh!', 'opaque', 'plugins.yugioh.deck_formats', 'plugins.yugioh.ygoprodeck', ('front',)),
}

def capabilities():
    return {'games': json.loads(json.dumps(GAME_METADATA))}


def _natural_key(path):
    return [int(part) if part.isdigit() else part.casefold()
            for part in re.split(r'(\d+)', path.name)]


def _callback_metadata(game, args, kwargs):
    """Extract card identity and requested quantity from existing plugin callbacks."""
    index = args[0] if args and isinstance(args[0], int) else kwargs.get('index')
    specs = {
        'altered': (1, 2, (1,)),
        'arkham_horror_lcg': (1, 2, (1,)),
        'ashes_reborn': (1, 3, (2,)),
        'bushiroad': (1, 4, (1,)),
        'digimon': (1, 2, (1,)),
        'echoes_of_astra': (1, 3, (1,)),
        'elestrals': (1, 3, (1,)),
        'final_fantasy': (1, 3, (2,)),
        'flesh_and_blood': (1, 3, (2,)),
        'grand_archive': (1, 2, (1,)),
        'gundam': (1, 2, (1,)),
        'keyforge': (1, 2, (1,)),
        'lorcana': (1, 3, (1,)),
        'lotr_lcg': (2, 4, (1, 2)),
        'netrunner': (1, 2, (1,)),
        'one_piece': (1, 2, (1,)),
        'riftbound': (1, 2, (1,)),
        'sorcery_contested_realm': (1, 3, (1,)),
        'star_wars_unlimited': (1, 3, (1, 2)),
    }
    name_index, qty_index, key_indices = specs.get(game, (None, None, ()))
    name = args[name_index] if name_index is not None and len(args) > name_index else None
    quantity = args[qty_index] if qty_index is not None and len(args) > qty_index else 1
    keys = [args[i] for i in key_indices if len(args) > i and args[i] is not None]
    if name is not None:
        keys.insert(0, name)
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 1:
        quantity = 1
    return {'index': index, 'name': str(name).strip() if name else '',
            'quantity': quantity, 'keys': [str(key).strip() for key in keys if str(key).strip()]}


def _record_call(records, front, back, metadata, callback, args, kwargs):
    before_front = set(front.iterdir())
    before_back = set(back.iterdir())
    error = None
    try:
        return callback(*args, **kwargs)
    except Exception as exc:
        error = str(exc)
        raise
    finally:
        records.append({
            **metadata,
            'front_files': sorted(set(front.iterdir()) - before_front, key=_natural_key),
            'back_files': sorted(set(back.iterdir()) - before_back, key=_natural_key),
            'error': error,
        })


def _log_metadata(output):
    by_index = {}
    for line in output.splitlines():
        match = re.search(r'\bIndex:\s*(\d+)', line)
        if not match:
            continue
        fields = {key.strip(): value.strip() for key, value in re.findall(r'([A-Za-z_ ]+):\s*([^,]+)', line)}
        by_index[int(match.group(1))] = fields
    return by_index


def _diagnostics(output):
    errors, warnings = [], []
    for line in output.splitlines():
        line = line.strip()
        if re.match(r'^(?:Error|Errors|Failed|Could not)\b\s*:', line, re.I):
            if line.lower().startswith('errors:') and errors:
                continue
            errors.append(line)
        elif re.match(r'^Warning\s*:', line, re.I):
            warnings.append(line)
    return errors, warnings


def _normalized_key(value):
    return re.sub(r'[^a-z0-9]+', '', str(value).casefold())


class GameImporter:
    def __init__(self, cache_dir):
        self.root=Path(cache_dir).resolve(); self.root.mkdir(parents=True,exist_ok=True)

    def import_game(self, request):
        game=request.get('game'); fmt=request.get('format'); item=GAMES.get(game)
        if not item: raise ValueError('Unknown game')
        label,kind,parser_module,api_module,backs=item
        input_data=request.get('input') or {}; value=input_data.get('value')
        format_row=next((f for f in capabilities()['games'] if f['id']==game),None)
        format_meta=next((f for f in format_row['formats'] if f['id']==fmt),None) if format_row else None
        if not format_meta: raise ValueError('Unsupported deck format')
        if input_data.get('kind') != format_meta['inputKind'] or not isinstance(value,str) or not value or len(value)>2_000_000: raise ValueError('Invalid game input')
        options=request.get('options') or {}
        with tempfile.TemporaryDirectory(prefix='gui-game-') as tmp:
            front=Path(tmp)/'front'; back=Path(tmp)/'back'; front.mkdir(); back.mkdir()
            parser=importlib.import_module(parser_module)
            api=importlib.import_module(api_module)
            parser_output=io.StringIO()
            records=[]
            try:
              with contextlib.redirect_stdout(parser_output):
                if game=='yugioh':
                    cards=parser.parse_deck(value, parser.DeckFormat(fmt))
                    fetch_card_art=api.fetch_card_art
                    # The parser's insertion-ordered mapping is the deck order.
                    for code,qty in cards.items():
                        metadata={'name': str(code), 'quantity': qty if isinstance(qty, int) and qty > 0 else 1, 'keys':[str(code)]}
                        try:
                            _record_call(records, front, back, metadata, fetch_card_art, (code, qty, str(front)), {})
                        except Exception:
                            # Keep successfully fetched cards when one passcode fails.
                            continue
                elif game=='lotr_lcg':
                    handler=api.get_handle_card(str(front),str(back))
                    parser.parse_deck(value,parser.DeckFormat(fmt),lambda *args,**kwargs: _record_call(records,front,back,_callback_metadata(game,args,kwargs),handler,args,kwargs),scenario_mode=options.get('scenario','normal'))
                elif game=='elestrals':
                    handler=api.get_handle_card(str(front))
                    parser.parse_deck(value,parser.DeckFormat(fmt),lambda *args,**kwargs: _record_call(records,front,back,_callback_metadata(game,args,kwargs),handler,args,kwargs))
                else:
                    if game in ('ashes_reborn','riftbound'):
                        handler=api.get_handle_card(api.ImageServer(options.get('source', next(iter(api.ImageServer)).value)),str(front))
                    elif game in ('arkham_horror_lcg','bushiroad','star_wars_unlimited'):
                        handler=api.get_handle_card(str(front),str(back))
                    else:
                        handler=api.get_handle_card(str(front))
                    parser.parse_deck(value,parser.DeckFormat(fmt),lambda *args,**kwargs: _record_call(records,front,back,_callback_metadata(game,args,kwargs),handler,args,kwargs))
            except Exception as exc:
                # A parser-level failure must not publish any staged cache files.
                raise RuntimeError(str(exc)) from exc
            output=parser_output.getvalue()
            logged_errors, warnings=_diagnostics(output)
            callback_errors=[record for record in records if record['error']]
            parse_errors=[line for line in logged_errors if not any(record['error'] in line for record in callback_errors)]
            parse_errors.extend(f"{record['name'] or 'Card'}: {record['error']}" for record in callback_errors)
            log_names=_log_metadata(output)
            local_backs={}
            local_dir=options.get('localBackDir') if game=='lotr_lcg' else None
            if local_dir:
                local_path=Path(local_dir).resolve()
                if not local_path.is_dir(): raise ValueError('Local back scans folder is unavailable')
                for path in sorted(local_path.iterdir(), key=_natural_key):
                    if path.is_file() and path.suffix.lower() in {'.png','.jpg','.jpeg','.webp'}:
                        local_backs.setdefault(_normalized_key(path.stem),path)
            entries=[]
            created=[]
            try:
                for record in records:
                    if not record['front_files']:
                        continue
                    source_front=record['front_files'][0]
                    logged=log_names.get(record.get('index'),{}) if record.get('index') is not None else {}
                    logged_name=logged.get('name') if game!='elestrals' else None
                    name=(logged_name or record['name'] or logged.get('code') or source_front.stem).strip()
                    cid=uuid.uuid4().hex; target=self.root/(cid+'.png')
                    with Image.open(source_front) as image:
                        image.convert('RGBA').save(target,format='PNG')
                    created.append(target)
                    entry={'id':cid,'name':name,'qty':record['quantity'],'cacheId':cid,'faces':[{'url':target.as_uri(),'name':name}]}
                    matching_back=next((p for p in record['back_files'] if p.stem==source_front.stem),None)
                    if matching_back is None and local_backs:
                        matching_back=next((local_backs.get(_normalized_key(key)) for key in record['keys'] if local_backs.get(_normalized_key(key))),None)
                    if matching_back is not None:
                        bid=uuid.uuid4().hex; btarget=self.root/(bid+'.png')
                        with Image.open(matching_back) as image:
                            image.convert('RGBA').save(btarget,format='PNG')
                        created.append(btarget)
                        entry['back']={'cacheId':bid,'url':btarget.as_uri()}
                    entries.append(entry)
            except Exception:
                for target in created:
                    target.unlink(missing_ok=True)
                raise
            if not entries and not parse_errors:
                parse_errors=['No cards were imported']
            errors=[{'source':value,'message':message} for message in parse_errors]
            return {'status':'partial' if errors and entries else 'failure' if errors else 'success','entries':entries,'errors':errors,'warnings':[{'source':value,'message':message} for message in warnings]}
