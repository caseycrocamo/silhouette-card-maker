import json

import utilities


def test_text_box_layouts_survive_parent_layout_schema():
    config = utilities.load_layout_config()
    with open(utilities.layouts_path, encoding='utf-8') as layout_file:
        raw = json.load(layout_file)

    assert 'text_box' in config.card_sizes
    assert set(raw['text_box_layouts']) == set(config.paper_sizes)
    assert raw['text_box_layouts']['arch_b']['width'] == 675
    assert len(raw['text_box_layouts']['arch_b']['x_pos']) > 0


def test_text_box_registration_uses_current_paper_definition():
    config = utilities.load_layout_config()
    paper = config.paper_sizes['letter']
    registration = config.defaults.registration.default

    image = utilities.page_manager.generate_reg_mark(
        paper.width, paper.height, registration.inset, registration.thickness,
        registration.length, 300, utilities.Registration.FOUR,
    )

    assert image.size == (3300, 2550)


def test_text_box_pdf_renders_all_paper_sizes(tmp_path):
    source = tmp_path / 'entries.md'
    source.write_text('**Test card** {W}\n\nDraw a card.\n---\n*Second card* {2}{U}', encoding='utf-8')
    for paper_size in utilities.load_layout_config().paper_sizes:
        output = tmp_path / f'{paper_size}.pdf'
        utilities.generate_md_pdf(str(source), str(output), paper_size, 72, 75)
        assert output.read_bytes().startswith(b'%PDF')
