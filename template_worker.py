#!/usr/bin/env python3
"""JSON-lines worker for GUI DXF template operations."""
import contextlib
import io
import json
import re
import sys
import os
from pathlib import Path

# The user-data delta is created on first launch, before utilities loads it.
_extra = __import__("os").environ.get("SCM_EXTRA_LAYOUTS", "")
for _candidate in _extra.split(__import__("os").pathsep):
    if _candidate and Path(_candidate).name == "custom-layouts.json":
        Path(_candidate).parent.mkdir(parents=True, exist_ok=True)
        if not Path(_candidate).exists():
            Path(_candidate).write_text("{}\n", encoding="utf-8")

from click.testing import CliRunner

import generate_dxf
from enums import Orientation, OrientationMode, Variant
from utilities import find_best_orientation, load_layout_config
import page_manager
import size_convert


def _layout_catalog():
    config = load_layout_config()
    return {
        "card_sizes": [
            {"name": n, "width": d.width, "height": d.height,
             "radius": d.radius, "aliases": d.aliases}
            for n, d in sorted(config.card_sizes.items())
        ],
        "paper_sizes": [
            {"name": n, "width": d.width, "height": d.height,
             "aliases": d.aliases}
            for n, d in sorted(config.paper_sizes.items())
        ],
        "layouts": [
            {"paper_size": p, "card_size": c,
             "variants": [{"name": v, "orientation": d.orientation.value,
                           "version": d.version, "rows": d.num_rows,
                           "cols": d.num_cols}
                          for v, d in variants.items()]}
            for p, cards in config.layouts.items()
            for c, variants in cards.items()
        ],
        "output_dir": str(generate_dxf.CUTTING_TEMPLATES_DIR),
    }


def _optimized_geometry(config, paper, card, variant):
    card_def, paper_def = config.card_sizes[card], config.paper_sizes[paper]
    reg = config.defaults.registration.borderless if variant == "borderless" else config.defaults.registration.default
    orientation, computed = find_best_orientation(
        OrientationMode.OPTIMIZE, card_def.width, card_def.height,
        paper_def.width, paper_def.height, inset=reg.inset,
        length=f"{size_convert.size_to_mm(reg.length) + page_manager.REG_PADDING_MM}mm",
        ppi=config.ppi, preferred=Orientation.LANDSCAPE,
    )
    return {
        "orientation": orientation.value,
        "num_rows": len(computed.y_pos),
        "num_cols": len(computed.x_pos),
        "max_length_mm": computed.max_length_mm,
    }


def _save_layout_override(paper, card, variant, definition):
    target = os.environ.get("SCM_LAYOUT_OVERRIDES")
    if not target:
        raise RuntimeError("SCM_LAYOUT_OVERRIDES is not configured.")
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    raw.setdefault("layouts", {}).setdefault(paper, {}).setdefault(card, {})[variant] = definition
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(path)


def _run_single(request):
    # Click builds Choice objects at import time; refresh them so definitions
    # saved earlier in this worker session can be selected immediately.
    config = load_layout_config()
    generate_dxf.card_size_choices = __import__("utilities").get_all_card_size_names(config)
    generate_dxf.paper_size_choices = __import__("utilities").get_all_paper_size_names(config)
    for param in generate_dxf.single.params:
        if param.name == "card_size":
            param.type.choices = tuple(generate_dxf.card_size_choices)
        elif param.name == "paper_size":
            param.type.choices = tuple(generate_dxf.paper_size_choices)
    variant = str(request.get("variant", "default")).lower()
    optimize_layout = bool(request.get("optimize_layout"))
    paper_size, card_size = request.get("paper_size"), request.get("card_size")
    old_layout = (config.layouts.get(paper_size, {}).get(card_size, {}).get(variant)
                  if paper_size and card_size else None)
    output = Path(request.get("output_path") or request.get("path") or
                  (generate_dxf.CUTTING_TEMPLATES_DIR / variant / "dxf" / "template.dxf"))
    args = ["single", str(output)]
    mapping = {
        "card_size": "--card_size", "paper_size": "--paper_size",
        "card_width": "--card_width", "card_height": "--card_height",
        "card_radius": "--card_radius", "card_name": "--card_name",
        "paper_width": "--paper_width", "paper_height": "--paper_height",
        "paper_name": "--paper_name", "variant": "--variant",
        "orientation": "--orientation",
    }
    for key, option in mapping.items():
        value = request.get(key)
        if value is not None and value != "":
            args.extend([option, str(value)])
    if request.get("save") or (optimize_layout and old_layout is None):
        args.append("--save")
    result = CliRunner().invoke(generate_dxf.cli, args, standalone_mode=False)
    if result.exception:
        message = str(result.exception)
        if result.output.strip():
            message = result.output.strip().splitlines()[-1]
        return {"ok": False, "error": message, "path": str(output)}
    metadata = result.return_value
    rows, cols, capacity = metadata["rows"], metadata["cols"], metadata["capacity"]
    actual_orientation = metadata["orientation"]
    version = metadata["version"]
    if optimize_layout and paper_size and card_size:
        geometry = _optimized_geometry(config, paper_size, card_size, variant)
        actual_orientation = geometry["orientation"]
        if rows != geometry["num_rows"] or cols != geometry["num_cols"]:
            return {"ok": False, "error": "Generated DXF geometry did not match the optimized layout.", "path": str(output)}
        if old_layout:
            changed = (old_layout.orientation.value != geometry["orientation"] or
                       old_layout.num_rows != rows or old_layout.num_cols != cols)
            if changed:
                version = int(request.get("version", old_layout.version + 1))
                definition = {
                    "orientation": geometry["orientation"],
                    "version": int(version),
                    "num_rows": rows,
                    "num_cols": cols,
                    "registration": {"length": f"{geometry['max_length_mm']}mm"},
                }
                _save_layout_override(paper_size, card_size, variant, definition)
        elif request.get("save"):
            # Click saves the new definition into the app's custom-layout delta.
            version = 1
    return {"ok": True, "path": str(output), "rows": rows, "cols": cols,
            "capacity": capacity, "max_length_mm": metadata["max_length_mm"],
            "orientation": actual_orientation,
            "version": version,
            "variant": variant, "card_size": metadata["card_size"],
            "paper_size": metadata["paper_size"],
            "saved_layout_paths": (
                ([os.environ["SCM_LAYOUT_OVERRIDES"]] if optimize_layout and old_layout and
                 (old_layout.orientation.value != actual_orientation or old_layout.num_rows != rows or old_layout.num_cols != cols)
                 else []) +
                ([str(p) for p in generate_dxf.extra_layout_paths()] if request.get("save") else []))}


def _batch(request, optimize=False):
    config = load_layout_config()
    base = Path(request.get("output_dir") or generate_dxf.CUTTING_TEMPLATES_DIR)
    mode = "optimize" if optimize else request.get("mode", "missing")
    results = []
    source = config.layouts
    if optimize:
        source = {paper: {card: {variant: None for variant in Variant} for card in config.card_sizes}
                  for paper in config.paper_sizes}
    for paper, cards in source.items():
        for card, variants in cards.items():
            for variant, layout in variants.items():
                variant = variant.value if isinstance(variant, Variant) else variant
                if variant not in ("default", "borderless"):
                    continue
                version = layout.version if layout else 1
                outdir = base / "borderless" / "dxf" if variant == "borderless" else base / "dxf"
                output = outdir / f"{generate_dxf.template_name(paper, card, Variant(variant), version)}.dxf"
                if mode == "missing" and output.exists():
                    results.append({"ok": True, "skipped": True, "path": str(output),
                                    "card_size": card, "paper_size": paper, "variant": variant})
                    continue
                if variant == "borderless":
                    paper_def = config.paper_sizes[paper]
                    width_in = __import__("size_convert").size_to_mm(paper_def.width) / 25.4
                    height_in = __import__("size_convert").size_to_mm(paper_def.height) / 25.4
                    if max(width_in, height_in) > 12 and not generate_dxf.borderless_fits_12x24_mat(paper_def.width, paper_def.height):
                        results.append({"ok": True, "skipped": True, "reason": "12x24 mat limit",
                                        "card_size": card, "paper_size": paper, "variant": variant})
                        continue
                item = _run_single({"card_size": card, "paper_size": paper, "variant": variant,
                                    "orientation": "optimize" if optimize else layout.orientation.value,
                                    "save": optimize, "output_path": str(output)})
                item.update({"card_size": card, "paper_size": paper, "variant": variant})
                results.append(item)
    return {"ok": all(item.get("ok", False) for item in results), "items": results,
            "saved_layout_paths": [str(p) for p in generate_dxf.extra_layout_paths()] if optimize else []}


def _manifest(request, optimize=False):
    config = load_layout_config()
    base = Path(request.get("output_dir") or generate_dxf.CUTTING_TEMPLATES_DIR)
    mode = "optimize" if optimize else request.get("mode", "missing")
    candidates = []
    source = config.layouts
    if optimize:
        source = {paper: {card: {variant.value: config.layouts.get(paper, {}).get(card, {}).get(variant.value)
                                for variant in Variant}
                         for card in config.card_sizes}
                  for paper in config.paper_sizes}
    for paper, cards in source.items():
        for card, variants in cards.items():
            for variant, layout in variants.items():
                variant = variant.value if isinstance(variant, Variant) else variant
                if variant not in ("default", "borderless"):
                    continue
                version = layout.version if layout else 1
                outdir = base / "borderless" / "dxf" if variant == "borderless" else base / "dxf"
                orientation = layout.orientation.value if layout else "optimize"
                if optimize:
                    try:
                        geometry = _optimized_geometry(config, paper, card, variant)
                    except ValueError as error:
                        candidates.append({"ok": False, "skipped": True, "error": str(error),
                                           "card_size": card, "paper_size": paper,
                                           "variant": variant})
                        continue
                    orientation = geometry["orientation"]
                    changed = bool(layout and (
                        layout.orientation.value != orientation or
                        layout.num_rows != geometry["num_rows"] or
                        layout.num_cols != geometry["num_cols"]))
                    if changed:
                        version += 1
                else:
                    orientation = layout.orientation.value
                output = outdir / f"{generate_dxf.template_name(paper, card, Variant(variant), version)}.dxf"
                if variant == "borderless":
                    paper_def = config.paper_sizes[paper]
                    actual_max = max(__import__("size_convert").size_to_mm(paper_def.width),
                                     __import__("size_convert").size_to_mm(paper_def.height)) / 25.4
                    if actual_max > 12 and not generate_dxf.borderless_fits_12x24_mat(paper_def.width, paper_def.height):
                        candidates.append({"skipped": True, "reason": "12x24 mat limit", "path": str(output),
                                           "card_size": card, "paper_size": paper, "variant": variant})
                        continue
                if mode == "missing" and output.exists():
                    candidates.append({"skipped": True, "path": str(output), "card_size": card,
                                       "paper_size": paper, "variant": variant})
                    continue
                candidates.append({"card_size": card, "paper_size": paper, "variant": variant,
                                   "orientation": orientation,
                                   "version": version, "path": str(output),
                                   "output_path": str(output),
                                   "optimize_layout": optimize,
                                   "save": optimize and layout is None})
    return {"ok": True, "items": candidates}


def _run_manifest(request, optimize=False):
    manifest = _manifest(request, optimize=optimize)
    results = []
    for candidate in manifest["items"]:
        if candidate.get("skipped") or candidate.get("ok") is False:
            results.append(candidate)
        else:
            results.append(_run_single(candidate))
    return {"ok": all(item.get("ok", True) for item in results), "items": results,
            "saved_layout_paths": [os.environ.get("SCM_LAYOUT_OVERRIDES"), *generate_dxf.extra_layout_paths()]}


def handle(request):
    command = request.get("command")
    if command == "list":
        return {"ok": True, **_layout_catalog()}
    if command == "single":
        return _run_single(request)
    if command == "batch":
        return _run_manifest(request)
    if command == "optimize":
        return _run_manifest(request, optimize=True)
    if command == "batch_manifest":
        return _manifest(request, optimize=request.get("mode") == "optimize")
    return {"ok": False, "error": f"Unknown template command: {command}"}


def main():
    # Electron sends UTF-8 JSON on every platform, including Windows.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(io.StringIO()):
                response = handle(request)
        except Exception as exc:  # Keep protocol alive after an invalid request.
            response = {"ok": False, "error": str(exc)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
