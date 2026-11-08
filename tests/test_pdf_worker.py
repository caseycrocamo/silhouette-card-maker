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
from click import Option
from create_pdf import cli as create_pdf_cmd, pdf_capabilities
from pdf_worker import dispatch


class PdfWorkerContractTest(unittest.TestCase):
    def test_capabilities_cover_every_creation_option(self):
        metadata = pdf_capabilities()
        json.dumps(metadata, ensure_ascii=False)
        expected = [p for p in create_pdf_cmd.params if isinstance(p, Option) and p.name not in {"help", "version"}]
        self.assertEqual(metadata["version"], 1)
        self.assertEqual([option["name"] for option in metadata["options"]], [p.name for p in expected])
        for option, param in zip(metadata["options"], expected):
            self.assertEqual(option["is_flag"], param.is_flag)
            self.assertEqual(option["multiple"], param.multiple)
            self.assertIn("default", option)
            self.assertIn("choices", option)
            self.assertIn("min", option)
            self.assertIn("max", option)
        self.assertTrue(metadata["layouts"])
        self.assertTrue(metadata["card_sizes"])
        self.assertTrue(metadata["paper_sizes"])

    def test_preflight_is_read_only_and_reports_deduplicated_skip_capacity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            front, back, double = (root / name for name in ("front", "back", "double"))
            for folder in (front, back, double):
                folder.mkdir()
            Image.new("RGB", (63, 88), "navy").save(front / "card.png")
            argv = ["--front_dir_path", str(front), "--back_dir_path", str(back),
                    "--double_sided_dir_path", str(double), "--only_fronts", "--skip", "0", "--skip", "0"]
            response = dispatch({"command": "preflight_create_pdf", "argv": argv})
            self.assertTrue(response["ok"])
            self.assertEqual(response["result"]["errors"], {})
            self.assertEqual(response["result"]["slot_capacity"], 8)


class FrozenWorkerTest(unittest.TestCase):
    def test_create_offset_and_reuse_with_unicode_paths(self):
        root = Path(__file__).resolve().parents[1]
        binary = Path(os.environ.get(
            "CARD_MAKER_PDF_WORKER",
            root / ("pdf_worker.exe" if sys.platform == "win32" else "pdf_worker"),
        ))
        with tempfile.TemporaryDirectory(prefix="Card Maker é 一 ") as temp:
            work = Path(temp)
            env = dict(os.environ, PYTHONIOENCODING="cp1252")
            for subdir in ("front", "back", "output", "double_sided", "data"):
                directory = work / subdir
                directory.mkdir()
                env[f"CARD_MAKER_{subdir.upper()}_DIR"] = str(directory)
            Image.new("RGB", (63, 88), "navy").save(work / "front" / "Card é 一.png")
            pdf = work / "output" / "game.pdf"
            custom_pdf = work / "output" / "custom é.pdf"
            png_dir = work / "PNG pages.v2 é"
            offset = work / "output" / "game_offset.pdf"
            requests = [
                {"command": "create_pdf", "args": ["--invalid-option"]},
                {"command": "pdf_capabilities"},
                {"command": "preflight_create_pdf", "argv": ["--only_fronts"]},
                {"command": "create_pdf", "argv": ["--only_fronts", "--ppi", "72", "--label", "Test é 一", "--output_path", str(custom_pdf)]},
                {"command": "offset_pdf", "pdf_path": str(custom_pdf), "output_pdf_path": str(offset), "x_offset": 1, "y_offset": 2, "angle": 0.25, "save": True, "ppi": 72},
                {"command": "create_pdf", "argv": ["--only_fronts", "--load_offset", "--ppi", "72"]},
                {"command": "create_pdf", "argv": ["--only_fronts", "--output_images", "--output_path", str(png_dir)]},
            ]
            # ensure_ascii=False matches JSON.stringify() in the Electron client.
            result = subprocess.run(
                [str(binary)], cwd=work, env=env, encoding="utf-8",
                input="".join(json.dumps(req, ensure_ascii=False) + "\n" for req in requests),
                capture_output=True, timeout=120,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            responses = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(len(responses), 8, result.stdout)
            self.assertEqual(responses[0], {"ready": True})
            self.assertFalse(responses[1]["ok"])
            self.assertEqual(responses[2]["result"]["version"], 1)
            self.assertTrue(responses[2]["result"]["options"])
            self.assertEqual(responses[3]["result"]["errors"], {})
            self.assertEqual(responses[3]["result"]["slot_capacity"], 8)
            for response in responses[4:]:
                self.assertTrue(response["ok"], response)
            self.assertEqual(responses[4]["result"], {"kind": "pdf", "destination": str(custom_pdf), "files": [str(custom_pdf)]})
            self.assertIn(str(offset), responses[5]["log"])
            self.assertIn("Card é 一.png", responses[4]["log"])
            self.assertEqual(responses[7]["result"]["kind"], "images")
            self.assertEqual(Path(responses[7]["result"]["destination"]), png_dir)
            self.assertEqual(len(responses[7]["result"]["files"]), 1)
            for output in (custom_pdf, pdf, offset):
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
            self.assertEqual((saved["x_offset"], saved["y_offset"], saved["angle_offset"]), (1, 2, 0.25))
            self.assertTrue((png_dir / "page1.png").is_file())


if __name__ == "__main__":
    unittest.main()
