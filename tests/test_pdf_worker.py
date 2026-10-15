"""Smoke-test the frozen worker on any OS: python -m unittest discover -s tests."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image
import pypdfium2 as pdfium


class FrozenWorkerTest(unittest.TestCase):
    def test_create_offset_and_reuse_with_unicode_paths(self):
        root = Path(__file__).resolve().parents[1]
        binary = root / ("pdf_worker.exe" if sys.platform == "win32" else "pdf_worker")
        with tempfile.TemporaryDirectory(prefix="Card Maker é 一 ") as temp:
            work = Path(temp)
            env = dict(os.environ, PYTHONIOENCODING="cp1252")
            for subdir in ("front", "back", "output", "double_sided", "data"):
                directory = work / subdir
                directory.mkdir()
                env[f"CARD_MAKER_{subdir.upper()}_DIR"] = str(directory)
            Image.new("RGB", (63, 88), "navy").save(work / "front" / "Card é 一.png")
            pdf = work / "output" / "game.pdf"
            offset = work / "output" / "game_offset.pdf"
            requests = [
                {"command": "create_pdf", "args": ["--invalid-option"]},
                {"command": "create_pdf", "args": ["--only_fronts", "--ppi", "72", "--name", "Test é 一"]},
                {"command": "offset_pdf", "pdf_path": str(pdf), "x_offset": 1, "y_offset": 2, "save": True, "ppi": 72},
                {"command": "create_pdf", "args": ["--only_fronts", "--load_offset", "--ppi", "72"]},
            ]
            # ensure_ascii=False matches JSON.stringify() in the Electron client.
            result = subprocess.run(
                [str(binary)], cwd=work, env=env, encoding="utf-8",
                input="".join(json.dumps(req, ensure_ascii=False) + "\n" for req in requests),
                capture_output=True, timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            responses = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(len(responses), 5, result.stdout)
            self.assertEqual(responses[0], {"ready": True})
            self.assertFalse(responses[1]["ok"])
            for response in responses[2:]:
                self.assertTrue(response["ok"], response)
            self.assertIn(str(offset), responses[3]["log"])
            self.assertIn("Card é 一.png", responses[2]["log"])
            for output in (pdf, offset):
                document = pdfium.PdfDocument(output)
                try:
                    self.assertEqual(len(document), 1)
                    page = document[0]
                    try:
                        self.assertEqual(page.get_size(), (792, 612))
                    finally:
                        page.close()
                finally:
                    document.close()
            saved = json.loads((work / "data" / "offset_data.json").read_text(encoding="utf-8"))
            self.assertEqual((saved["x_offset"], saved["y_offset"]), (1, 2))


if __name__ == "__main__":
    unittest.main()
