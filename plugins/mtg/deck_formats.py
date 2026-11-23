import csv
import io
import json
import os
import re
import ssl

from enum import Enum
from typing import Callable
from xml.etree import ElementTree as ET
from urllib.parse import urlparse

import cloudscraper
import mtg_parser
import requests

from plugins.mtg.common import remove_nonalphanumeric
from plugins.mtg.url_sections import read_sections
from utilities import guess_extension

TEXT_FORMATS = frozenset(('default', 'simple', 'mtga', 'mtgo', 'archidekt', 'deckstats', 'moxfield'))
SECTION_NAMES = frozenset(('about', 'deck', 'main', 'mainboard', 'sideboard', 'commander',
                           'commanders', 'companion', 'companions', 'maybeboard', 'considering'))
URL_PARSERS = (
    mtg_parser.AetherhubDeckParser, mtg_parser.ArchidektDeckParser,
    mtg_parser.DeckstatsDeckParser, mtg_parser.MoxfieldDeckParser,
    mtg_parser.MtggoldfishDeckParser, mtg_parser.MtgjsonDeckParser,
    mtg_parser.ScryfallDeckParser, mtg_parser.TappedoutDeckParser,
    mtg_parser.TcgplayerDeckParser,
)


def parse_card_line(raw: str):
    """Read the shared SCM, Arena, MTGO, Archidekt, Moxfield and Deckstats syntax."""
    line = raw.strip()
    if (not line or line.startswith(('//', '#')) or
            line.lower().rstrip(':') in SECTION_NAMES):
        return None
    quantity = 1
    count = re.match(r'^(\d+)[xX]?\s+', line)
    if count:
        quantity = int(count[1])
        line = line[count.end():].strip()
    if quantity < 1 or quantity > 9007199254740991:
        raise ValueError('Enter a positive whole quantity.')

    set_code = collector_number = ''
    prefix = re.match(r'^\[([\w]+)?#([^\]]+)\]\s*', line)
    if prefix:
        set_code, collector_number = prefix[1] or '', prefix[2].strip()
        line = line[prefix.end():]

    # Site annotations are not part of the printed name or collector number.
    line = re.split(r'\s+(?:\[|#!|\^|\*[A-Za-z]+\*)', line, maxsplit=1)[0].strip()
    printing = re.search(r'\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+))?$', line)
    if printing:
        set_code, collector_number = printing[1], printing[2] or ''
        line = line[:printing.start()].strip()
    if not line or re.fullmatch(r'\d+[xX]?', line):
        raise ValueError('Enter a card name.')
    return line, set_code, collector_number, quantity


def parse_card_list(deck_text, handle_card: Callable, errors=None) -> None:
    """Parse mixed text exports, retaining valid rows and reporting failed rows."""
    index = 0
    about = False
    for source_line, raw in enumerate(deck_text.splitlines(), 1):
        try:
            line = raw.strip()
            if line.lower().rstrip(':') == 'about':
                about = True
                continue
            if about and line.lower().startswith('name '):
                about = False
                continue
            if line:
                about = False
            card = parse_card_line(raw)
            if card is None:
                continue
            index += 1
            handle_card(index, *card)
        except Exception as exc:
            message = f'Line {source_line}: {exc}'
            print(f'Error: {message}')
            if errors is not None:
                errors.append({'line': source_line, 'message': str(exc)})


# Keep CLI names and imports compatible; all text formats use the same reader.
parse_simple_list = parse_mtga = parse_mtgo = parse_card_list
parse_archidekt = parse_deckstats = parse_moxfield = parse_card_list

# Scryfall deck builder JSON
def parse_scryfall_json(deck_text, handle_card: Callable, front_img_dir: str = '', double_sided_dir: str = '', image_handler: Callable = None) -> None:
    data = json.loads(deck_text)
    entries = data.get("entries", {})
    for entry in entries.values():
        for index, item in enumerate(entry, start=1):
            card_digest = item.get("card_digest", {})
            if card_digest is None:
                continue

            name = card_digest.get("name", "")
            set_code = card_digest.get("set", "")
            collector_number = card_digest.get("collector_number", "")
            quantity = item.get("count", 1)
            image_uris = card_digest.get("image_uris")

            parts = [f'Index: {index}', f'quantity: {quantity}']
            if set_code: parts.append(f'set code: {set_code}')
            if collector_number: parts.append(f'collector number: {collector_number}')
            if name: parts.append(f'name: {name}')
            print(', '.join(parts))

            # Scryfall JSON may already include image URIs, so we can fetch directly without an extra Scryfall API call. If not, fall back to handle_card which will query Scryfall by set/collector number or name.
            if image_uris and image_uris.get("front") and image_handler:
                image_handler(index, name, set_code, collector_number, quantity, image_uris["front"], image_uris.get("back"))
            elif image_uris and front_img_dir:
                clean_name = remove_nonalphanumeric(name)

                front_url = image_uris.get("front")
                if front_url:
                    response = requests.get(front_url, headers={'user-agent': 'silhouette-card-maker/0.1', 'accept': '*/*'})
                    response.raise_for_status()
                    for counter in range(quantity):
                        with open(os.path.join(front_img_dir, f'{index}{clean_name}{counter + 1}.png'), 'wb') as f:
                            f.write(response.content)

                back_url = image_uris.get("back")
                if back_url and double_sided_dir:
                    response = requests.get(back_url, headers={'user-agent': 'silhouette-card-maker/0.1', 'accept': '*/*'})
                    response.raise_for_status()
                    for counter in range(quantity):
                        with open(os.path.join(double_sided_dir, f'{index}{clean_name}{counter + 1}.png'), 'wb') as f:
                            f.write(response.content)
            else:
                handle_card(index, name, set_code, collector_number, quantity)

# MPCFill XML
def extract_card_name(raw_name: str) -> str:
    """Extract card name by stripping the file extension (e.g. 'Mountain.png' -> 'Mountain')."""
    parts = raw_name.split(".")
    return ".".join(parts[:-1]) if len(parts) > 1 else parts[0]


def extract_mpcfill_card_ids(deck_text: str) -> set[str]:
    """Extract all unique card IDs from MPCFill XML for prefetching."""
    data = ET.fromstring(deck_text)
    card_ids = set()

    fronts = data.find("fronts")
    if fronts:
        for front in fronts.findall("card"):
            card_ids.add(front.find("id").text)

    backs = data.find("backs")
    if backs is not None:
        for back in backs.findall("card"):
            card_ids.add(back.find("id").text)

    return card_ids


def parse_mpcfill_xml(deck_text, handle_card: Callable) -> None:
    """
    Parse MPCFill XML and call handle_card once per slot.

    Each slot represents one physical card. handle_card signature:
        handle_card(slot, front_id, front_name, back_id, back_name)

    back_id and back_name will be None if the slot has no custom back.
    """
    data = ET.fromstring(deck_text)
    fronts = data.find("fronts")
    backs = data.find("backs")

    card_qty = int(data.find("details").find("quantity").text)

    # Create per-slot entries: {front_id, front_name, back_id, back_name}
    slots = [{"front_id": None, "front_name": None, "back_id": None, "back_name": None} for _ in range(card_qty)]

    if fronts is None:
        raise ValueError("No fronts found in decklist")

    # Assign fronts to ALL their slots
    for front in fronts.findall("card"):
        card_id = front.find("id").text
        name = extract_card_name(front.find("name").text)
        slot_indices = [int(s) for s in front.find("slots").text.split(",")]
        for slot_idx in slot_indices:
            slots[slot_idx]["front_id"] = card_id
            slots[slot_idx]["front_name"] = name

    # Assign backs to ALL their slots
    if backs is not None:
        for back in backs.findall("card"):
            card_id = back.find("id").text
            name = extract_card_name(back.find("name").text)
            slot_indices = [int(s) for s in back.find("slots").text.split(",")]
            for slot_idx in slot_indices:
                slots[slot_idx]["back_id"] = card_id
                slots[slot_idx]["back_name"] = name

    # Call handle_card once per slot (1-indexed for display and filenames)
    for slot_idx, slot in enumerate(slots):
        slot_num = slot_idx + 1
        if slot["front_id"] is None:
            print(f"Warning: Slot {slot_num} has no front image, skipping")
            continue

        print(f"Slot {slot_num}: {slot['front_name']}" + (f" / {slot['back_name']}" if slot['back_id'] else ""))
        handle_card(slot_num, slot["front_id"], slot["front_name"], slot["back_id"], slot["back_name"])

# CubeCobra CSV
# Exported from CubeCobra (https://cubecobra.com)
# CSV columns: name, CMC, Type, Color, Set, Collector Number, Rarity, Color Category,
#              status, Finish, maybeboard, image URL, image Back URL, tags, Notes, MTGO ID, Custom
#
# Cards with an image URL are fetched directly. Cards without an image URL are fetched
# from Scryfall using set and collector number, or by name as a fallback.
# Identical cards are tallied to minimize Scryfall API calls.
def parse_cubecobra_csv(deck_text, handle_card: Callable, front_img_dir: str, double_sided_dir: str, image_handler: Callable = None) -> None:
    reader = csv.DictReader(io.StringIO(deck_text))

    # Phase 1: Parse all rows and tally unique cards
    # Key: (name, set_code, collector_number, image_url, image_back_url)
    # Value: quantity (number of identical rows)
    unique_cards = {}

    for row in reader:
        name = row.get('name', '')
        set_code = row.get('Set', '')
        collector_number = row.get('Collector Number', '')
        image_url = row.get('image URL', '')
        image_back_url = row.get('image Back URL', '')

        key = (name, set_code, collector_number, image_url, image_back_url)
        unique_cards[key] = unique_cards.get(key, 0) + 1

    total_cards = sum(unique_cards.values())
    print(f'Parsed {total_cards} cards into {len(unique_cards)} unique entries')

    # Phase 2: Process unique cards
    error_lines = []

    index = 0
    for (name, set_code, collector_number, image_url, image_back_url), quantity in unique_cards.items():
        index += 1

        parts = [f'Index: {index}', f'quantity: {quantity}']
        if set_code: parts.append(f'set code: {set_code}')
        if collector_number: parts.append(f'collector number: {collector_number}')
        if name: parts.append(f'name: {name}')
        print(', '.join(parts))

        try:
            if image_url and image_handler:
                image_handler(index, name, set_code, collector_number, quantity, image_url, image_back_url)
            elif image_url:
                # Fetch image directly from URL
                print(f'Fetching image from URL: {image_url}')
                clean_name = remove_nonalphanumeric(name)
                response = requests.get(image_url, headers={'user-agent': 'silhouette-card-maker/0.1', 'accept': '*/*'})
                response.raise_for_status()
                ext = guess_extension(response.content)
                for counter in range(quantity):
                    image_path = os.path.join(front_img_dir, f'{str(index)}{clean_name}{str(counter + 1)}{ext}')
                    with open(image_path, 'wb') as f:
                        f.write(response.content)

                if image_back_url:
                    print(f'Fetching back image from URL: {image_back_url}')
                    back_response = requests.get(image_back_url, headers={'user-agent': 'silhouette-card-maker/0.1', 'accept': '*/*'})
                    back_response.raise_for_status()
                    back_ext = guess_extension(back_response.content)
                    for counter in range(quantity):
                        image_path = os.path.join(double_sided_dir, f'{str(index)}{clean_name}{str(counter + 1)}{back_ext}')
                        with open(image_path, 'wb') as f:
                            f.write(back_response.content)
            else:
                # Fetch from Scryfall using set/collector number or name
                handle_card(index, name, set_code, collector_number, quantity)
        except Exception as e:
            print(f'Error: {e}')
            error_lines.append((name, e))

    if len(error_lines) > 0:
        print(f'Errors: {error_lines}')

# URL Auto-Import
#   Supported sites:
#     Aetherhub, Archidekt, Deckstats, Moxfield, MTG Goldfish,
#     MTGJSON, Scryfall, Tapped Out, TCGPlayer
def parse_url(deck_url, handle_card: Callable, options=None) -> None:
    deck_url = deck_url.strip()
    if urlparse(deck_url).scheme not in ('http', 'https'):
        print('URL not recognized: enter an HTTP or HTTPS deck URL.')
        return
    # Select only online readers. The library's general dispatcher can fall
    # back to treating an unsupported URL as a card name.
    parser = next((reader for cls in URL_PARSERS if (reader := cls()).can_handle(deck_url)), None)
    if parser is None:
        print(f'URL not recognized by any supported site: {deck_url}')
        return
    reader = parser._parse_deck
    parser._parse_deck = lambda document: read_sections(parser, reader, document, options or {})
    scraper = cloudscraper.create_scraper(ssl_context=ssl.create_default_context(cafile=requests.certs.where()))
    # Site readers do not set timeouts themselves.
    original_request = scraper.request
    def bounded_request(method, url, **kwargs):
        kwargs.setdefault('timeout', (5, 30))
        response = original_request(method, url, **kwargs)
        response.raise_for_status()
        return response
    scraper.request = bounded_request
    try:
        # The reader fetches the site's document, then calls its site parser.
        cards = parser.parse_deck(deck_url, scraper)
    except Exception as e:
        print(f"Error while fetching deck from URL: {deck_url} ({e})")
        return

    if not cards:
        print(f"Failed to read deck from URL: {deck_url}")
        return

    error_lines = []
    card_iter = iter(cards)
    index = 0

    while True:
        try:
            card = next(card_iter)
        except StopIteration:
            break
        except Exception as e:
            # mtg_parser lazily fetches/parses per card, so a site-side issue
            # (deck deleted, made private, malformed API response, etc.) only
            # surfaces here, mid-iteration, rather than when parse_deck() is called.
            print(
                f"Failed to parse deck from URL: {deck_url}. "
                f"The deck may be private, deleted, or the URL may be incorrect. "
                f"(underlying error: {e!r})"
            )
            break

        index += 1
        try:
            # mtg_parser selects the site's reader, downloads its document, and
            # parses that document. Feed its records into the shared SCM reader.
            if not isinstance(card.name, str) or not card.name.strip():
                raise ValueError('The deck contains an empty card name.')
            if not isinstance(card.quantity, int) or isinstance(card.quantity, bool) or card.quantity < 1:
                raise ValueError('Enter a positive whole quantity.')
            line = f'{card.quantity} {card.name}'
            if card.extension:
                line += f' ({card.extension})'
                if card.number is not None and str(card.number):
                    line += f' {card.number}'
            parsed = parse_card_line(line)
            if parsed is None:
                raise ValueError('The deck contains an empty card record.')
            handle_card(index, *parsed)
        except Exception as e:
            print(f'Error: {e}')
            error_lines.append((card.name, e))

    if len(error_lines) > 0:
        print(f'Errors: {error_lines}')

class DeckFormat(str, Enum):
    DEFAULT = "default"
    ARCHIDEKT = "archidekt"
    CUBECOBRA_CSV = "cubecobra_csv"
    DECKSTATS = "deckstats"
    MOXFIELD = "moxfield"
    MPCFILL_XML = "mpcfill_xml"
    MTGA = "mtga"
    MTGO = "mtgo"
    SCRYFALL_JSON = "scryfall_json"
    SIMPLE = "simple"
    URL = "url"

def parse_deck(deck_text: str, format: DeckFormat, handle_card: Callable, front_img_dir: str = '', double_sided_dir: str = '', image_handler: Callable = None) -> None:
    if format in TEXT_FORMATS:
        parse_card_list(deck_text, handle_card)
    elif format == DeckFormat.SCRYFALL_JSON:
        parse_scryfall_json(deck_text, handle_card, front_img_dir, double_sided_dir, image_handler)
    elif format == DeckFormat.MPCFILL_XML:
        parse_mpcfill_xml(deck_text, handle_card)
    elif format == DeckFormat.CUBECOBRA_CSV:
        parse_cubecobra_csv(deck_text, handle_card, front_img_dir, double_sided_dir, image_handler)
    elif format == DeckFormat.URL:
        parse_url(deck_text, handle_card)
    else:
        raise ValueError("Unrecognized deck format")
