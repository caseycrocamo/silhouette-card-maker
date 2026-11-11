"""Export game options so the GUI can open them without starting Python."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from plugins.gui_game_metadata import GAMES


def build_catalog():
    return {"version": 1, "games": GAMES}


if __name__ == "__main__":
    destination = ROOT / "GUI/shared/gameCatalog.json"
    destination.write_text(json.dumps(build_catalog(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported game options to {destination}")
