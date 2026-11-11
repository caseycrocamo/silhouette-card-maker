from os import path
from re import compile, search
from enum import Enum
import cloudscraper
from time import sleep
from urllib.parse import quote

PILTOVER_URL_TEMPLATE = 'https://cdn.piltoverarchive.com/cards/{card_number}.webp'
RIFTMANA_URL_TEMPLATE = 'https://riftmana.com/wp-content/uploads/Cards/{card_number}.webp'

class ImageServer(str, Enum):
    PILTOVER = 'piltover_archive'
    RIFTMANA = 'riftmana'

# Create a persistent cloudscraper session for connection pooling
scraper = cloudscraper.create_scraper()

def request_api(query: str) -> cloudscraper.CloudScraper:
    r = scraper.get(query, headers = {'user-agent': 'silhouette-card-maker/0.1', 'accept': '*/*'}, timeout=30)

    # Check for 2XX response code
    r.raise_for_status()

    sleep(0.075)

    return r

def fetch_card_art(index: int, card_number: str, quantity: int, source: ImageServer, front_img_dir: str):
    url_template = PILTOVER_URL_TEMPLATE
    if source == ImageServer.RIFTMANA:
        url_template = RIFTMANA_URL_TEMPLATE

    image_server_query = url_template.format(card_number=card_number)
    api_response = request_api(image_server_query)

    # Otherwise, try to retrieve the art for the signature art of the card since the request failed for alternate art
    if api_response is None:
        alternate_art_suffix_pattern = compile(r'^([A-Z0-9]+-\d+)a$')
        match = search(alternate_art_suffix_pattern, card_number)
        if match:
            image_server_query = url_template.format(card_number=f'{match.group(1)}s')
            api_response = request_api(image_server_query)

    if api_response is not None:
        card_art = api_response.content

        if card_art is not None:
            # Save image based on quantity
            for counter in range(quantity):
                image_path = path.join(front_img_dir, f'{index}{card_number}_{counter + 1}.jpg')

                with open(image_path, 'wb') as f:
                    f.write(card_art)

def fetch_card_number(name: str) -> str:
    # Use the same provider as the Piltover deck format. Riftmana no longer
    # exposes its WordPress card search endpoint.
    url = f"https://piltoverarchive.com/api/external/v1/cards?name={quote(name, safe='')}"
    variants = request_api(url).json().get('data', [])
    matches = [variant for variant in variants
               if variant.get('card', {}).get('name', '').casefold() == name.casefold()
               and variant.get('variantNumber')]
    # Prefer regular artwork when the name has several printings.
    standard = next((variant for variant in matches
                     if variant.get('variantType') == 'Standard'), None)
    if standard or matches:
        return (standard or matches[0])['variantNumber']
    raise ValueError(f'Card not found: {name}')


def get_handle_card(
    source: ImageServer,
    front_img_dir: str
):
    def configured_fetch_card(index: int, card_number: str, quantity: int):
        fetch_card_art(
            index,
            card_number,
            quantity,
            source,
            front_img_dir
        )

    return configured_fetch_card
