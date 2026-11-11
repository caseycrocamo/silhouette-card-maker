# Printer calibration completion record

Status: implemented. Source checks pass; native platform results are recorded in
the root report.

- Settings edits saved X/Y/angle and accepts per-run overrides, PPI, and output
  paths. Apply does not save. Saved values use atomic replacement and retain zero.
- The PDF worker generates selected or all configured calibration papers, with
  runtime custom sizes and writable output folders. Generation is safe to import.
- Existing saves without angle load as zero. The CLI remains available.

Checks: CLI and worker output pixels match for negative, zero, and positive
fractional angles. Front pages stay unchanged; back pages move. Old saves and
no-save application preserve saved file bytes. Existing IPC tests cover malformed
numbers, zero overrides, rotation, output paths, and untrusted callers. Generation
tests cover all papers, selected papers, two PPIs, PDF dimensions, rendering, and
invalid inputs. The real Settings offset/sheet smoke and custom-paper integration
smoke passed. Letter and A4 sheets at 72 and 150 PPI were rendered for layout
review; physical printer alignment still needs an actual printer.

Remaining: installed Windows/Linux checks without Python and physical print
alignment. See the root report for isolated macOS frozen-helper evidence.
