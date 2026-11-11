"""Keep bundled game choices in sync with the Python import service."""
import json
from pathlib import Path

from scripts.export_game_catalog import build_catalog


def test_bundled_game_catalog_matches_python_metadata():
    root = Path(__file__).resolve().parents[1]
    bundled = json.loads((root / 'GUI/shared/gameCatalog.json').read_text(encoding='utf-8'))
    assert bundled == build_catalog()
