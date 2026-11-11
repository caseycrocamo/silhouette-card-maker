import tempfile
import unittest
from pathlib import Path

import generate_calibration
import pypdfium2 as pdfium


class CalibrationGenerationTests(unittest.TestCase):
    def test_generates_selected_sizes_at_requested_ppi(self):
        with tempfile.TemporaryDirectory(prefix='calibration-测试-') as directory:
            output = Path(directory)
            paths = generate_calibration.generate_calibration_sheets(
                ['letter', 'a4'], output, 72
            )
            self.assertEqual(len(paths), 2)
            self.assertEqual({Path(path).name for path in paths}, {
                'letter-calibration.pdf', 'a4-calibration.pdf'
            })
            for path in paths:
                pdf = Path(path).read_bytes()
                self.assertTrue(pdf.startswith(b'%PDF-'))
                self.assertIn(b'D:20000101000000Z', pdf)
                self.assertIn(b'/MediaBox', pdf)
                with pdfium.PdfDocument(path) as document:
                    self.assertEqual(len(document), 2)
                    for page in document:
                        width, height = page.get_size()
                        self.assertGreater(width, 500)
                        self.assertGreater(height, 500)
                        rendered = page.render(scale=0.2).to_pil().convert('RGB')
                        pixels = rendered.tobytes()
                        self.assertGreater(sum(1 for i in range(0, len(pixels), 3) if pixels[i:i + 3] != b'\xff\xff\xff'), 100)
            high_resolution = generate_calibration.generate_calibration_sheets(['letter'], output, 150)
            with pdfium.PdfDocument(high_resolution[0]) as document:
                width, height = document[0].get_size()
                self.assertAlmostEqual(width, 792, places=1)
                self.assertAlmostEqual(height, 612, places=1)

    def test_generates_all_configured_sizes_when_selection_is_omitted(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = generate_calibration.generate_calibration_sheets(output_dir=directory, ppi=72)
            self.assertEqual(len(paths), len(generate_calibration.load_layout_config().paper_sizes))

    def test_rejects_invalid_ppi_and_unknown_paper(self):
        with tempfile.TemporaryDirectory() as directory:
            for ppi in (0, -1, 72.5, True):
                with self.subTest(ppi=ppi), self.assertRaises(ValueError):
                    generate_calibration.generate_calibration_sheets(['letter'], directory, ppi)
            with self.assertRaisesRegex(ValueError, 'Unsupported paper size'):
                generate_calibration.generate_calibration_sheets(['missing'], directory, 72)


if __name__ == '__main__':
    unittest.main()
