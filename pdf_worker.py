"""Long-lived PDF worker process.

Started once at app launch, this process pays the one-time import/startup cost
(PyInstaller onefile self-extraction + macOS Gatekeeper scan) a single time and
then services both `create_pdf` and `offset_pdf` requests over stdin/stdout for
the rest of the session.

Protocol: one JSON request object per input line, one JSON response object per
output line. Requests are handled strictly one at a time (single-threaded) — the
stdout capture below swaps process-global `sys.stdout`, so concurrency is not
safe here. Do not add threading without redesigning stdout capture.

Response shape: {"ok": bool, "log": str, "error": str}.
"""

import contextlib
import io
import json
import sys

# Importing these is where the one-time startup tax is paid. Both are unmodified
# click.Command objects living at the repo root.
from create_pdf import cli as create_pdf_cmd, pdf_capabilities
import click
from utilities import get_all_card_size_names, get_all_paper_size_names, get_all_specialty_layout_names
from offset_pdf import offset_pdf as offset_pdf_cmd
from utilities import load_layout_config, resolve_pdf_layout, parse_crop_string, parse_dimension_string
import os
from pathlib import Path
import page_manager
import size_convert
from enums import Variant


def refresh_creation_choices():
    """Reload saved app layouts before Click validates a persistent-worker request."""
    config = load_layout_config()
    choices = {
        "card_size": get_all_card_size_names(config),
        "paper_size": get_all_paper_size_names(config),
        "specialty": get_all_specialty_layout_names(config),
    }
    for param in create_pdf_cmd.params:
        if param.name in choices:
            param.type = click.Choice(choices[param.name], case_sensitive=False)


def handle_create_pdf(req):
    """Invoke create_pdf via Click's own parser so option handling never drifts."""
    args = req.get("argv", req.get("args", []))
    buf = io.StringIO()
    error = ""
    ok = True
    try:
        with contextlib.redirect_stdout(buf):
            refresh_creation_choices()
            ctx = create_pdf_cmd.make_context("create_pdf", list(args))
            result = create_pdf_cmd.invoke(ctx)
    except Exception as e:  # includes Click's UsageError for bad args
        ok = False
        error = str(e)
    return {"ok": ok, "log": buf.getvalue(), "error": error, "result": result if ok else None}


def handle_preflight(req):
    """Validate a create request without invoking PDF generation or changing inputs."""
    errors, warnings, capacity = {}, [], None
    computed = None
    argv = req.get("argv", [])
    try:
        refresh_creation_choices()
        ctx = create_pdf_cmd.make_context("create_pdf", list(argv))
        values = ctx.params
    except Exception as e:
        return {"ok": True, "log": "", "error": "", "result": {"errors": {"settings": str(e)}, "warnings": [], "slot_capacity": None}}
    for key in ("front_dir_path", "back_dir_path", "double_sided_dir_path"):
        path = Path(values[key])
        if not path.is_dir():
            errors[key] = f'Folder "{path}" does not exist.'
    if Path(values["front_dir_path"]).is_dir():
        from utilities import get_image_file_paths
        if not get_image_file_paths(values["front_dir_path"]):
            errors["front_dir_path"] = "The front image folder contains no supported images."
    if not values.get("output_images") and not str(values["output_path"]).lower().endswith(".pdf"):
        errors["output_path"] = "The output path must end in .pdf."
    try:
        config = load_layout_config()
        if values.get("specialty"):
            if values.get("borderless"):
                errors["borderless"] = "Borderless cannot be used with a specialty layout."
            specialty = config.specialty_layouts.get(values["specialty"]) if config.specialty_layouts else None
            if specialty is None:
                errors["specialty"] = "Specialty layout was not found."
            else:
                cs = specialty.card_size
                ps = specialty.paper_size
                card_def = config.card_sizes[cs.name] if cs.name else None
                card_w, card_h = (card_def.width, card_def.height) if card_def else (cs.width, cs.height)
                paper_def = config.paper_sizes[ps.name] if ps.name else None
                paper_w, paper_h = (paper_def.width, paper_def.height) if paper_def else (ps.width, ps.height)
                reg_settings = specialty.registration
                inset = reg_settings.inset if reg_settings and reg_settings.inset else config.defaults.registration.default.inset
                exclusion_mm = size_convert.size_to_mm(config.defaults.registration.default.length) + page_manager.REG_PADDING_MM
                computed = page_manager.generate_layout(specialty.orientation, card_w, card_h,
                    paper_w, paper_h, inset, f"{exclusion_mm}mm", config.ppi)
                capacity = len(computed.x_pos) * len(computed.y_pos)
                if capacity < 1:
                    errors["specialty"] = "The selected specialty layout does not fit its page geometry."
                for key in ("crop", "crop_backs"):
                    try:
                        parse_crop_string(values.get(key), computed.card_width_px, computed.card_height_px)
                    except ValueError as e:
                        errors[key] = str(e)
        else:
            card, paper, layout = resolve_pdf_layout(config, values["card_size"], values["paper_size"], values["borderless"])
            card_def, paper_def = config.card_sizes[card], config.paper_sizes[paper]
            reg_settings = layout.registration
            inset = (reg_settings.inset if reg_settings and reg_settings.inset else
                     config.defaults.registration.borderless.inset if values["borderless"] else
                     config.defaults.registration.default.inset)
            reg_default = config.defaults.registration.default
            exclusion_mm = size_convert.size_to_mm(reg_default.length) + page_manager.REG_PADDING_MM
            computed = page_manager.generate_layout(layout.orientation, card_def.width, card_def.height,
                paper_def.width, paper_def.height, inset, f"{exclusion_mm}mm", config.ppi)
            capacity = len(computed.x_pos) * len(computed.y_pos)
            if capacity < 1:
                errors["card_size"] = "The selected card size does not fit on the selected paper."
            for key in ("crop", "crop_backs"):
                try:
                    parse_crop_string(values.get(key), computed.card_width_px, computed.card_height_px)
                except ValueError as e:
                    errors[key] = str(e)
        if capacity is not None:
            skips = sorted(set(values.get("skip") or []))
            if len([s for s in skips if s < capacity]) >= capacity:
                errors["skip"] = "You cannot skip all card positions on a page."
            out_of_range = [s for s in skips if s >= capacity]
            if out_of_range:
                warnings.append(f"Skip positions outside the {capacity} available slots will be ignored: {out_of_range}.")
        for key in ("extend_edges", "extend_edges_backs", "extend_corners", "extend_corners_backs", "extend_bleed", "extend_bleed_backs"):
            try:
                parse_dimension_string(values.get(key), config.ppi)
            except ValueError as e:
                errors[key] = str(e)
    except Exception as e:
        errors.setdefault("layout", str(e))
    if values.get("only_fronts") and Path(values["double_sided_dir_path"]).is_dir():
        from utilities import get_image_file_paths, check_paths_subset
        ds_files = get_image_file_paths(values["double_sided_dir_path"])
        if ds_files:
            errors["only_fronts"] = "Fronts only cannot be used while double-sided source images exist."
    if all(Path(values[k]).is_dir() for k in ("front_dir_path", "double_sided_dir_path")):
        from utilities import get_image_file_paths, check_paths_subset
        fronts = set(get_image_file_paths(values["front_dir_path"]))
        backs = set(get_image_file_paths(values["double_sided_dir_path"]))
        missing = check_paths_subset(backs, fronts)
        if missing:
            errors["double_sided_dir_path"] = f"Double-sided images have no matching front: {sorted(missing)}."
    if values.get("load_offset"):
        from utilities import load_saved_offset
        if load_saved_offset() is None:
            warnings.append("No saved printer offset exists; generation will use no offset.")
    preview = None
    if computed is not None:
        preview = {"width": computed.paper_width_px, "height": computed.paper_height_px,
                   "card_width": computed.card_width_px, "card_height": computed.card_height_px,
                   "x": computed.x_pos, "y": computed.y_pos}
    return {"ok": True, "log": "", "error": "", "result": {"errors": errors, "warnings": warnings, "slot_capacity": capacity, "preview": preview}}


def handle_capabilities():
    refresh_creation_choices()
    return {"ok": True, "log": "", "error": "", "result": pdf_capabilities()}


def handle_offset_pdf(req):
    """Call the raw callback directly, bypassing Click's argv parsing/sys.exit.

    Because `.callback` skips Click's default-filling, every parameter must be
    supplied explicitly. `offset_pdf.py` swallows FileNotFoundError internally
    (prints "Cannot offset nonexistent PDF: ..." instead of raising), so a
    missing file is not an error case here — it only shows up in the log.
    """
    buf = io.StringIO()
    error = ""
    ok = True
    try:
        with contextlib.redirect_stdout(buf):
            offset_pdf_cmd.callback(
                pdf_path=req["pdf_path"],
                output_pdf_path=req.get("output_pdf_path", None),
                x_offset=req.get("x_offset", None),
                y_offset=req.get("y_offset", None),
                angle=req.get("angle", None),
                save=req.get("save", False),
                ppi=req.get("ppi", 300),
            )
    except Exception as e:
        ok = False
        error = str(e)
    return {"ok": ok, "log": buf.getvalue(), "error": error}


def handle_generate_calibration(req):
    """Generate sheets on the existing serial worker, without import side effects."""
    log = io.StringIO()
    try:
        from generate_calibration import generate_calibration_sheets
        with contextlib.redirect_stdout(log):
            paths = generate_calibration_sheets(
                paper_sizes=req.get("paper_sizes"),
                output_dir=req.get("output_dir") or str(Path(os.environ.get("CARD_MAKER_DATA_DIR", "data")) / "calibration"),
                ppi=req.get("ppi", 300),
            )
        return {"ok": True, "log": log.getvalue(), "error": "", "result": {"paths": paths}}
    except Exception as error:
        return {"ok": False, "log": log.getvalue(), "error": str(error)}


def dispatch(req):
    command = req.get("command")
    if command == "create_pdf":
        return handle_create_pdf(req)
    if command == "pdf_capabilities":
        return handle_capabilities()
    if command == "preflight_create_pdf":
        return handle_preflight(req)
    if command == "generate_calibration":
        return handle_generate_calibration(req)
    if command == "offset_pdf":
        return handle_offset_pdf(req)
    return {"ok": False, "log": "", "error": f"unknown command: {command}"}


def main():
    # Node writes UTF-8 JSON to the pipe. Windows otherwise decodes stdin with
    # the local code page, corrupting paths and card names containing accents.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")

    # Signal readiness only after the expensive imports above have completed.
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        # A broad guard so one malformed request can never kill the loop.
        try:
            req = json.loads(line)
            resp = dispatch(req)
        except Exception as e:
            resp = {"ok": False, "log": "", "error": str(e)}

        print(json.dumps(resp), flush=True)


if __name__ == "__main__":
    main()
