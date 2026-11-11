"""Translation CLI checks with the same request values used by the GUI service."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pypdfium2 as pdfium
import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('quality', [0, 100])
def test_translation_custom_paper_quality_and_source_preservation(tmp_path, quality):
    extra = tmp_path / 'custom-layouts.json'
    extra.write_text(json.dumps({'paper_sizes': {'translation_custom': {
        'width': '11in', 'height': '8.5in'
    }}}))
    source = tmp_path / 'entrée-原稿.md'
    text = '\n---\n'.join(f'### Card {index} {{W}}{{2}}{{U}}\n\n**Bold text**, *italic text*.\nDraw a card.' for index in range(30))
    source.write_text(text, encoding='utf8')
    output = tmp_path / f'出力-{quality}.pdf'
    result = subprocess.run([sys.executable, str(ROOT / 'translated_text_boxes_to_pdf.py'),
        '--input_path', str(source), '--output_path', str(output),
        '--paper_size', 'translation_custom', '--ppi', '72', '--quality', str(quality)],
        cwd=ROOT, env=dict(os.environ, SCM_EXTRA_LAYOUTS=str(extra)), capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert source.read_text(encoding='utf8') == text
    with pdfium.PdfDocument(output) as document:
        assert len(document) > 1
        assert document[0].get_size() == pytest.approx((792, 612), abs=1)
        image = document[0].render(scale=0.25).to_pil().convert('RGB')
        assert image.getextrema() != ((255, 255), (255, 255), (255, 255))


@pytest.mark.parametrize('flag,value', [('--ppi', '0'), ('--quality', '-1'), ('--quality', '101'), ('--ppi', '1.5')])
def test_translation_cli_rejects_malformed_numbers(tmp_path, flag, value):
    source = tmp_path / 'input.md'
    source.write_text('text')
    output = tmp_path / 'output.pdf'
    result = subprocess.run([sys.executable, str(ROOT / 'translated_text_boxes_to_pdf.py'),
        '--input_path', str(source), '--output_path', str(output), flag, value],
        cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert result.returncode != 0
    assert not output.exists()
