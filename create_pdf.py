import os
import re
import json

import click
from utilities import Registration, FitMode, generate_pdf, load_layout_config, get_all_card_size_names, get_all_paper_size_names, get_all_specialty_layout_names
from enums import Orientation

# Use environment variables if available, otherwise fall back to local game directory
front_directory = os.environ.get('CARD_MAKER_FRONT_DIR', os.path.join('game', 'front'))
back_directory = os.environ.get('CARD_MAKER_BACK_DIR', os.path.join('game', 'back'))
double_sided_directory = os.environ.get('CARD_MAKER_DOUBLE_SIDED_DIR', os.path.join('game', 'double_sided'))
output_directory = os.environ.get('CARD_MAKER_OUTPUT_DIR', os.path.join('game', 'output'))

default_output_path = os.path.join(output_directory, 'game.pdf')

layout_config = load_layout_config()
card_size_choices = get_all_card_size_names(layout_config)
paper_size_choices = get_all_paper_size_names(layout_config)
specialty_choices = get_all_specialty_layout_names(layout_config)

@click.command()
@click.option("--front_dir_path", default=front_directory, show_default=True, help="The path to the directory containing the card fronts.")
@click.option("--back_dir_path", default=back_directory, show_default=True, help="The path to the directory containing one or more card backs.")
@click.option("--double_sided_dir_path", default=double_sided_directory, show_default=True, help="The path to the directory containing card backs for double-sided cards.")
@click.option("--output_path", default=default_output_path, show_default=True, help="The desired path to the output PDF.")
@click.option("--output_images", default=False, is_flag=True, help="Create images instead of a PDF.")

@click.option("--card_size", default="standard", type=click.Choice(card_size_choices, case_sensitive=False), show_default=True, help="The desired card size.")
@click.option("--paper_size", default="letter", type=click.Choice(paper_size_choices, case_sensitive=False), show_default=True, help="The desired paper size.")
@click.option("--registration", default=Registration.THREE.value, type=click.Choice([t.value for t in Registration], case_sensitive=False), show_default=True, help="The desired registration pattern.")
@click.option("--registration_orientation", default=None, type=click.Choice([t.value for t in Orientation], case_sensitive=False), help="Override the registration mark orientation without changing the card layout.")
@click.option("--specialty", default=None, type=click.Choice(specialty_choices, case_sensitive=False), help="Use specialty geometry. Card and paper size settings are ignored; registration mark count and orientation remain editable.")

@click.option("--only_fronts", default=False, is_flag=True, help="Only generate front pages.")
@click.option("--fit", default=FitMode.STRETCH.value, type=click.Choice([t.value for t in FitMode], case_sensitive=False), show_default=True, help="How to fit front and double-sided images to card size. 'stretch' allows distortion, 'crop' preserves aspect ratio by center-cropping.")
@click.option("--fit_backs", type=click.Choice([t.value for t in FitMode], case_sensitive=False), help="How to fit back images to card size. 'stretch' allows distortion, 'crop' preserves aspect ratio by center-cropping.")

@click.option("--crop", help="Crop card edges of front and double-sided images (removes edges). Examples: 3mm, 0.125in, 6.5.")
@click.option("--crop_backs", help="Crop card edges of back images (removes edges). Examples: 3mm, 0.125in, 6.5.")
@click.option("--extend_edges", help="Crop card edges and extend them for front and double-sided images. Examples: 3mm, 0.125in.")
@click.option("--extend_edges_backs", help="Crop card edges and extend them for back images only. Examples: 3mm, 0.125in.")
@click.option("--extend_corners", help="Extend rounded corner regions to reduce corner artifacts for front and double-sided images. Examples: 3mm, 0.125in.")
@click.option("--extend_corners_backs", help="Extend rounded corner regions to reduce corner artifacts for back images only. Examples: 3mm, 0.125in.")
@click.option("--extend_bleed", help="Extend the outer bleed of outer cards on front pages (odd-numbered pages). Examples: 3mm, 0.125in.")
@click.option("--extend_bleed_backs", help="Extend the outer bleed of outer cards on back pages (even-numbered pages). Examples: 3mm, 0.125in.")

@click.option("--ppi", default=300, type=click.IntRange(min=1), show_default=True, help="Pixels per inch (PPI) when creating PDF.")
@click.option("--quality", default=100, type=click.IntRange(min=0, max=100), show_default=True, help="File compression quality.")
@click.option("--load_offset", default=False, is_flag=True, help="Apply saved offsets. See `offset_pdf.py` for more information.")
@click.option("--skip", type=click.IntRange(min=0), multiple=True, help="Skip a card based on its index. Useful for registration issues. Examples: 0, 4.")

@click.option("--label", help="Apply a custom label to each page.")
@click.option("--show_outline", default=False, is_flag=True, help="Show a white outline for cutting paths.")
@click.option("--borderless", default=False, is_flag=True, help="Use tighter inset to fit more cards per page.")

@click.version_option("3.0.0")

def cli(
    front_dir_path,
    back_dir_path,
    double_sided_dir_path,
    output_path,
    output_images,
    card_size,
    paper_size,
    registration,
    registration_orientation,
    specialty,
    only_fronts,
    fit,
    fit_backs,
    crop,
    crop_backs,
    extend_edges,
    extend_edges_backs,
    extend_corners,
    extend_corners_backs,
    extend_bleed,
    extend_bleed_backs,
    ppi,
    quality,
    skip,
    load_offset,
    label,
    show_outline,
    borderless
):
    return generate_pdf(
        front_dir_path,
        back_dir_path,
        double_sided_dir_path,
        output_path,
        output_images,
        card_size,
        paper_size,
        registration,
        only_fronts,
        fit,
        fit_backs,
        crop,
        crop_backs,
        extend_edges,
        extend_edges_backs,
        extend_corners,
        extend_corners_backs,
        extend_bleed,
        extend_bleed_backs,
        ppi,
        quality,
        skip,
        load_offset,
        label,
        show_outline,
        specialty=specialty,
        borderless=borderless,
        registration_orientation_override=registration_orientation,
    )


def pdf_capabilities():
    """Return option metadata and layout availability from the CLI configuration."""
    options = []
    for param in cli.params:
        if not isinstance(param, click.Option) or param.name in {"help", "version"}:
            continue
        if param.name == "version":
            continue
        default = param.default
        try:
            json.dumps(default)
        except (TypeError, ValueError):
            default = None  # Click 8.4 uses a Sentinel for optional values with no default.
        item = {
            "name": param.name,
            "default": default,
            "choices": list(param.type.choices) if isinstance(param.type, click.Choice) else None,
            "min": getattr(param.type, "min", None),
            "max": getattr(param.type, "max", None),
            "is_flag": param.is_flag,
            "multiple": param.multiple,
        }
        options.append(item)
    config = load_layout_config()
    card_sizes = [{"name": n, **d.model_dump(mode="json")} for n, d in config.card_sizes.items()]
    for item in card_sizes:
        item["aliases"] = item.get("aliases") or []
    paper_sizes = [{"name": n, **d.model_dump(mode="json")} for n, d in config.paper_sizes.items()]
    for item in paper_sizes:
        item["aliases"] = item.get("aliases") or []
    layouts = []
    for paper, cards in config.layouts.items():
        for card, variants in cards.items():
            layouts.append({"paper_size": paper, "card_size": card, "variants": [
                {"name": variant, "orientation": definition.orientation.value,
                 "registration_orientation": definition.registration_orientation.value if definition.registration_orientation else None,
                 "version": definition.version, "num_rows": definition.num_rows, "num_cols": definition.num_cols}
                for variant, definition in variants.items()
            ]})
    specialties = []
    for name, definition in (config.specialty_layouts or {}).items():
        item = {"name": name, **definition.model_dump(mode="json")}
        if definition.card_size.name:
            base = config.card_sizes[definition.card_size.name]
            item["card_size"].update({"width": base.width, "height": base.height,
                                      "radius": definition.card_size.radius or base.radius})
        if definition.paper_size.name:
            base = config.paper_sizes[definition.paper_size.name]
            item["paper_size"].update({"width": base.width, "height": base.height})
        specialties.append(item)
    return {"version": 1, "options": options, "card_sizes": card_sizes,
            "paper_sizes": paper_sizes, "layouts": layouts, "specialty_layouts": specialties}

if __name__ == '__main__':
    cli()
