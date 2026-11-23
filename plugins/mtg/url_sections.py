"""Select URL deck sections, then reuse the site's existing document reader."""
import csv
from html import unescape
import io
import re

from bs4 import BeautifulSoup
import mtg_parser


def section(value):
    name = re.sub(r'[^a-z]', '', str(value).lower())
    if name in ('side', 'sideboard'):
        return 'include_sideboard'
    if name in ('maybe', 'maybeboard', 'considering', 'considerations'):
        return 'include_maybeboard'
    if name in ('token', 'tokens'):
        return 'tokens'
    return None


def allowed(values, options):
    keys = {section(value) for value in values} - {None}
    return all(options.get(key, False) for key in keys)


def token_card(card):
    oracle = card.get('oracleCard', card)
    return (oracle.get('layout') in ('token', 'double_faced_token', 'emblem') or
            'Token' in (oracle.get('types') or []) or
            bool(re.search(r'\bToken\b|\bEmblem\b', oracle.get('type_line', ''))))


def read_sections(parser, reader, document, options):
    """Do not edit the downloaded document or replace a site's card parser."""
    if isinstance(parser, mtg_parser.ArchidektDeckParser) and 'cards' in document:
        categories = {item['name']: item for item in document.get('categories', [])}
        def selected(item):
            names = item.get('categories', [])
            card = item.get('card', {})
            is_token = token_card(card)
            if is_token and not options.get('tokens', False):
                return False
            boards = {section(name) for name in names} & {'include_sideboard', 'include_maybeboard'}
            if boards:
                return any(options.get(board, False) for board in boards)
            if is_token:
                return options.get('tokens', False)
            # Categories such as Ramp and Tokens describe a card's role. They
            # must not override board membership or turn token makers into tokens.
            main = not names or any(categories.get(name, {}).get('includedInDeck', False) for name in names)
            return main or options.get('include_maybeboard', False)
        document = {**document, 'cards': [item for item in document['cards'] if selected(item)],
                    'categories': [{**item, 'includedInDeck': True} for item in document.get('categories', [])]}
        yield from reader(document)
        return

    if isinstance(parser, mtg_parser.MoxfieldDeckParser) and 'mainboard' in document:
        def board(cards):
            return {name: item for name, item in cards.items()
                    if options.get('tokens', False) or not token_card(item.get('card', {}))}
        yield from reader({**document, 'mainboard': board(document['mainboard'])})
        for key, flag in [('sideboard', 'include_sideboard'), ('maybeboard', 'include_maybeboard'), ('tokens', 'tokens')]:
            cards = document.get(key, {})
            if options.get(flag, False) and cards:
                yield from reader({**document, 'commanders': {}, 'companions': {}, 'mainboard': board(cards)})
        return

    if isinstance(parser, mtg_parser.MtgjsonDeckParser) and 'data' in document:
        yield from reader(document)
        data = document['data']
        for key, flag in [('sideBoard', 'include_sideboard'), ('maybeBoard', 'include_maybeboard'), ('tokens', 'tokens')]:
            if options.get(flag, False) and data.get(key):
                yield from reader({**document, 'data': {**data, 'commander': [], 'mainBoard': data[key]}})
        return

    if isinstance(parser, mtg_parser.ScryfallDeckParser) and isinstance(document, str):
        rows = csv.DictReader(io.StringIO(document))
        if rows.fieldnames:
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=rows.fieldnames)
            writer.writeheader()
            writer.writerows(row for row in rows if allowed([row.get('section', '')], options))
            document = output.getvalue()

    if isinstance(parser, mtg_parser.DeckstatsDeckParser) and 'props' in document:
        def selected(item):
            flags = [item.get('section', item.get('board', ''))]
            flags += [name for name in ('sideboard', 'maybeboard', 'tokens') if item.get('is_' + name, False)]
            return allowed(flags, options)
        props = document['props']
        document = {**document, 'props': {**props, 'entries': [item for item in props.get('entries', []) if selected(item)]}}

    if isinstance(parser, mtg_parser.TcgplayerDeckParser) and 'result' in document:
        result = document['result']
        deck = result.get('deck', {})
        boards = deck.get('subDecks', {})
        main = list(boards.get('maindeck', []))
        for key, flag in [('maybeboard', 'include_maybeboard'), ('tokens', 'tokens')]:
            if options.get(flag, False):
                main.extend(boards.get(key, []))
        document = {**document, 'result': {**result, 'deck': {**deck, 'subDecks': {**boards,
            'maindeck': main, 'sideboard': boards.get('sideboard', []) if options.get('include_sideboard', False) else []}}}}

    if isinstance(parser, (mtg_parser.MtggoldfishDeckParser, mtg_parser.TappedoutDeckParser)) and isinstance(document, str):
        if isinstance(parser, mtg_parser.MtggoldfishDeckParser):
            html = unescape(document.replace("\\'", "'").replace('\\"', '"').replace('\\/', '/').replace(r'\n', ''))
            soup = BeautifulSoup(html, 'html.parser')
            table = soup.find('table', class_='deck-view-deck-table')
            current = ''
            if table:
                for row in table.find_all('tr', recursive=False):
                    if 'deck-category-header' in row.get('class', []):
                        current = row.get_text(strip=True)
                    elif not allowed([current], options):
                        row.decompose()
                document = str(soup)
        else:
            soup = BeautifulSoup(document, 'html.parser')
            container = soup.find('div', class_='board-container')
            if container:
                for link in container.select('a.card-hover, a.qty.board'):
                    heading = link.find_previous('h3')
                    if heading and not allowed([heading.get_text(strip=True)], options):
                        link.decompose()
                document = str(soup)

    for card in reader(document):
        if allowed(getattr(card, 'tags', []), options):
            yield card
