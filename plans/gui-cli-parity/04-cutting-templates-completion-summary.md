# Cutting templates completion record

Status: implemented. Source checks pass; native platform results are recorded in
the root report.

- Tools supports named/custom dimensions, radius, labels, variants, orientation,
  saved definitions, selected output, missing/all/optimized batches, progress,
  and cancellation between batch items.
- Saved definitions use app data. Running PDF/calibration workers refresh the
  merged catalog. Bundled definitions are not changed.
- Single borderless generation now applies the same 12x24 mat limit as batch
  generation. Oversized output is rejected before a DXF file is written.

Checks: worker tests cover save/reload, errors, output paths, missing/all behavior,
optimization geometry/version updates, aliases, units, radius, both variants,
all three orientation choices, CLI/worker geometry equivalence, mat limits, and
unchanged bundled layouts. The template page smoke and real template → saved
custom paper → calibration IPC smoke passed. Node tests cover catalog refresh,
removed selections, batch activity/cancellation, and worker shutdown.

Remaining: full installed-app checks on Windows and Linux, including shutdown of
an active batch. See the root report for isolated macOS frozen-helper evidence.
