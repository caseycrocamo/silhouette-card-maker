"""
Tests for the Riftbound plugin.
Tests deck format parsing and image fetching from Piltover Archive/Riftmana.
"""
import os
import shutil
import tempfile
import pytest

from plugins.riftbound.deck_formats import DeckFormat, parse_deck, parse_tts
from plugins.riftbound.api import request_api, get_handle_card, ImageServer


# --- Unit Tests for Deck Format Parsing ---

class TestTTSFormat:
    """Test Tabletop Simulator format parsing."""

    def test_parse_tts(self):
        """Test parsing TTS format (space-separated card codes)."""
        deck_text = "OGN-265-1 OGN-246-1 OGN-245-1"

        parsed_cards = []
        def collect_card(index, card_number, quantity):
            parsed_cards.append({
                'index': index,
                'card_number': card_number,
                'quantity': quantity
            })

        parse_tts(deck_text, collect_card)

        assert len(parsed_cards) == 3
        assert parsed_cards[0]['card_number'] == "OGN-265"
        assert parsed_cards[1]['card_number'] == "OGN-246"


class TestPiltoverArchiveFormat:
    """Test Piltover Archive format parsing."""

    def test_piltover_archive_line_pattern(self):
        """Test that Piltover Archive line pattern matches correctly."""
        import re
        pattern = re.compile(r'^(\d+) (.+)$')

        # Valid lines
        assert pattern.match("1 Viktor, Herald of the Arcane")
        assert pattern.match("3 Seal of Unity")

        # Invalid lines
        assert not pattern.match("")
        assert not pattern.match("Viktor, Herald of the Arcane")  # No quantity


@pytest.mark.parametrize('variants, expected', [
    ([{'card': {'name': 'Other card'}, 'variantNumber': 'OGN-001'},
      {'card': {'name': 'Seal of Unity'}, 'variantNumber': 'OGN-245a', 'variantType': 'Overnumbered'},
      {'card': {'name': 'Seal of Unity'}, 'variantNumber': 'OGN-245', 'variantType': 'Standard'}], 'OGN-245'),
    ([{'card': {'name': 'SEAL OF UNITY'}, 'variantNumber': 'OGN-245a'}], 'OGN-245a'),
    ([{'card': {'name': 'Other card'}, 'variantNumber': 'OGN-001'}], None),
])
def test_name_lookup_uses_piltover_and_requires_an_exact_match(monkeypatch, variants, expected):
    from types import SimpleNamespace
    from plugins.riftbound import api

    calls = []
    def request(url):
        calls.append(url)
        return SimpleNamespace(json=lambda: {'data': variants})
    monkeypatch.setattr(api, 'request_api', request)
    if expected:
        assert api.fetch_card_number('Seal of Unity') == expected
    else:
        with pytest.raises(ValueError, match='Card not found'):
            api.fetch_card_number('Seal of Unity')
    assert calls == ['https://piltoverarchive.com/api/external/v1/cards?name=Seal%20of%20Unity']


# --- Integration Tests for API and Image Fetching ---

@pytest.mark.integration
class TestRiftboundAPI:
    """Test Riftbound API requests."""

    def test_piltover_archive_api_availability(self):
        """Test that Piltover Archive API is available and responding."""
        response = request_api("https://cdn.piltoverarchive.com/cards/OGN-265.webp")
        assert response.status_code == 200


@pytest.mark.integration
class TestFullFetchWorkflow:
    """Integration tests for the complete card fetching workflow."""

    @pytest.fixture
    def temp_dirs(self):
        """Create temporary directories for test output."""
        front_dir = tempfile.mkdtemp()
        yield front_dir
        shutil.rmtree(front_dir)

    def test_fetch_single_card_tts(self, temp_dirs):
        """Test fetching a single card using TTS format."""
        front_dir = temp_dirs

        # Use a very small decklist - just 1 card
        deck_text = "OGN-265-1"

        handle_card = get_handle_card(ImageServer.PILTOVER, front_dir)
        parse_deck(deck_text, DeckFormat.TTS, handle_card)

        # Check that at least one image was created
        files = os.listdir(front_dir)
        assert len(files) >= 1

        # Verify image file has content (> 0 bytes)
        for f in files:
            file_path = os.path.join(front_dir, f)
            assert os.path.getsize(file_path) > 0

    def test_fetch_single_card_piltover(self, temp_dirs):
        """Test fetching a single card using Piltover Archive format."""
        front_dir = temp_dirs

        deck_text = "1 Seal of Unity"

        handle_card = get_handle_card(ImageServer.PILTOVER, front_dir)
        parse_deck(deck_text, DeckFormat.PILTOVER, handle_card)

        files = os.listdir(front_dir)
        assert len(files) >= 1

        for f in files:
            file_path = os.path.join(front_dir, f)
            assert os.path.getsize(file_path) > 0

    def test_fetch_with_quantity(self, temp_dirs):
        """Test fetching cards with quantity > 1."""
        front_dir = temp_dirs

        deck_text = "2 Seal of Unity"

        handle_card = get_handle_card(ImageServer.PILTOVER, front_dir)
        parse_deck(deck_text, DeckFormat.PILTOVER, handle_card)

        # Should have 2 copies of the card
        files = os.listdir(front_dir)
        assert len(files) == 2

        for f in files:
            file_path = os.path.join(front_dir, f)
            assert os.path.getsize(file_path) > 0
