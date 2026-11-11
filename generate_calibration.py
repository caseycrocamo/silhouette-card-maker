"""Generate two-page printer alignment sheets for configured paper sizes."""

import argparse
import math
import re
from pathlib import Path
from typing import Iterable, Optional

from PIL import Image, ImageDraw, ImageFont

import size_convert
from utilities import load_layout_config

SCRIPT_DIR = Path(__file__).parent
ASSET_DIR = Path(getattr(__import__('sys'), '_MEIPASS', SCRIPT_DIR)) / 'assets'
MARGIN = 150
DEFAULT_PPI = 300


def generate_calibration_sheets(paper_sizes: Optional[Iterable[str]] = None,
                                output_dir: Path = SCRIPT_DIR / 'calibration',
                                ppi: int = DEFAULT_PPI) -> list[str]:
    """Create calibration PDFs and return their paths.

    ``paper_sizes`` may be omitted to generate every configured size. PPI must
    be a positive whole number because it defines the raster and PDF resolution.
    """
    if isinstance(ppi, bool) or not isinstance(ppi, int) or ppi <= 0:
        raise ValueError('PPI must be a positive whole number.')
    config = load_layout_config()
    selected = list(paper_sizes) if paper_sizes is not None else list(config.paper_sizes)
    if not selected:
        raise ValueError('Select at least one paper size.')
    unknown = [name for name in selected if name not in config.paper_sizes]
    if unknown:
        raise ValueError(f'Unsupported paper size: {unknown[0]}')
    output_dir = Path(output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    scale = ppi / DEFAULT_PPI
    margin = max(1, round(MARGIN * scale))
    test_size = max(1, round(25 * scale))
    test_distance = max(1, round(75 * scale))
    font = ImageFont.truetype(str(ASSET_DIR / 'arial.ttf'), max(1, round(40 * scale)))
    coord_font = ImageFont.truetype(str(ASSET_DIR / 'arial.ttf'), max(1, round(25 * scale)))
    generated = []

    for paper_size in selected:
        paper_def = config.paper_sizes[paper_size]
        print_width = size_convert.size_to_pixel(paper_def.width, ppi)
        print_height = size_convert.size_to_pixel(paper_def.height, ppi)
        im = Image.new('RGB', (print_width, print_height), 'white')
        front_image, back_image = im.copy(), im.copy()
        ImageDraw.Draw(front_image).text((print_width // 2, margin), 'Front', fill='black', anchor='mt', font=font)
        ImageDraw.Draw(back_image).text((print_width // 2, margin), 'Back', fill='black', anchor='mt', font=font)

        matrix_size_x = math.floor(print_width / (test_size + test_distance)) - 6
        matrix_size_y = math.floor(print_height / (test_size + test_distance)) - 6
        if matrix_size_x <= 0 or matrix_size_y <= 0:
            raise ValueError(f'Paper size {paper_size} is too small for a calibration grid.')
        half_x, half_y = math.floor(matrix_size_x / 2), math.floor(matrix_size_y / 2)

        def start(length, matrix_size, half):
            if matrix_size % 2:
                return math.floor(length / 2) - (half * test_distance) - ((half + .5) * test_size)
            return math.floor(length / 2) - ((half - .5) * test_distance) - (half * test_size)

        start_x, start_y = start(print_width, matrix_size_x, half_x), start(print_height, matrix_size_y, half_y)
        front_draw, back_draw = ImageDraw.Draw(front_image), ImageDraw.Draw(back_image)
        half_dot = math.floor(test_size / 2)
        label_gap = round(30 * scale)
        for x_index in range(matrix_size_x):
            for y_index in range(matrix_size_y):
                x = start_x + x_index * (test_distance + test_size)
                y = start_y + y_index * (test_distance + test_size)
                fill = 'blue' if x_index == half_x or y_index == half_y else 'black'
                front_draw.rectangle([(x, y), (x + test_size, y + test_size)], fill=fill)
                back_x, back_y = x + x_index - half_x, y + y_index - half_y
                back_draw.rectangle([(back_x, back_y), (back_x + test_size, back_y + test_size)], fill=fill)
                back_draw.text((back_x + half_dot, back_y + half_dot + label_gap),
                               f'({x_index - half_x}, {half_y - y_index})',
                               fill='red', anchor='mm', font=coord_font)

        left_label = '(0, -y) <--- back page ---> (0, +y)'
        rotated = back_image.rotate(-90, expand=True)
        ImageDraw.Draw(rotated).text((print_height // 2, margin), left_label, fill='black', anchor='mt', font=font)
        back_image = rotated.rotate(90, expand=True)
        back_draw = ImageDraw.Draw(back_image)
        back_draw.text((print_width // 2, print_height - margin - test_distance / 2),
                       '(-x, 0) <--- back page ---> (+x, 0)', fill='black', anchor='mb', font=font)
        back_draw.text((print_width // 2, print_height - margin + test_distance / 2),
                       '+a rotates back page clockwise', fill='black', anchor='mb', font=font)

        output_path = output_dir / f'{paper_size}-calibration.pdf'
        front_image.save(output_path, save_all=True, append_images=[back_image.rotate(180)],
                         resolution=ppi, speed=0, subsampling=0, quality=100)
        pdf_bytes = re.sub(rb'D:\d{14}Z', b'D:20000101000000Z', output_path.read_bytes())
        output_path.write_bytes(pdf_bytes)
        generated.append(str(output_path.resolve()))
    return generated


generate_calibration = generate_calibration_sheets


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paper-size', action='append', dest='paper_sizes')
    parser.add_argument('--output-dir', type=Path, default=SCRIPT_DIR / 'calibration')
    parser.add_argument('--ppi', type=int, default=DEFAULT_PPI)
    args = parser.parse_args()
    for path in generate_calibration_sheets(args.paper_sizes, args.output_dir, args.ppi):
        print(f'Calibration PDF: {path}')


if __name__ == '__main__':
    main()
