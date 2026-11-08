"""Build the GUI settings catalog without requiring Python at screen load time."""
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from create_pdf import pdf_capabilities
from pdf_worker import handle_preflight


def build_catalog():
    catalog = pdf_capabilities()
    # Runtime paths belong to Electron, not the machine that builds the app.
    for option in catalog['options']:
        if option['name'].endswith('_dir_path') or option['name'] == 'output_path':
            option['default'] = None
    with tempfile.TemporaryDirectory(prefix='pdf-catalog-') as folder:
        paths = [flag for name in ('front', 'back', 'double_sided')
                 for flag in (f'--{name}_dir_path', str(Path(folder) / name))]
        def geometry(args):
            response = handle_preflight({'argv': paths + args})['result']
            if not response.get('preview'):
                raise ValueError(f'No preview for {args}: {response["errors"]}')
            return response['preview']
        for layout in catalog['layouts']:
            for variant in layout['variants']:
                args = ['--card_size', layout['card_size'], '--paper_size', layout['paper_size']]
                if variant['name'] == 'borderless':
                    args.append('--borderless')
                variant['preview'] = geometry(args)
        for specialty in catalog['specialty_layouts']:
            specialty['preview'] = geometry(['--specialty', specialty['name']])
    return catalog


if __name__ == '__main__':
    destination = ROOT / 'GUI/shared/pdfCatalog.json'
    destination.write_text(json.dumps(build_catalog(), ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Exported PDF settings and layout previews to {destination}')
