# Plan Completion Report

## 1. Blind Spots Analysis

- All seven parity feature groups now have source implementations and completion records under `plans/gui-cli-parity/`.
- Translation now shares the runtime paper catalog and layout environment with PDF creation and calibration. Quality 0 is preserved. Failed jobs preserve the prior PDF through staged output and atomic replacement.
- Plugin file retry retains its source and replaces results without multiplying quantities. A handler that produces no image reports an error instead of silent success. Plugins without entry-level retry APIs still reimport the source.
- MTG custom images retain their provenance and paired backs. Failed rows remove only their new cache files. Worker release and EOF cleanup own every cached face, invalidate released rows, and allow a fresh import.
- Studio jobs use trusted IPC, one active owner, structured prompts, stop events, bounded process cleanup, and the update activity gate. App quit waits for bounded cleanup before exit. Unsupported platforms do not load Windows automation. Build discovery requires Studio helpers only on Windows.
- Export locks the new file and preference controls while images are committed. Single borderless DXF generation now enforces the same mat limits as batch generation.

## 2. Completion Status

| Plan | Status | Remaining acceptance |
| --- | --- | --- |
| 01 — Game plugins | Partial — source implemented; release checks open | Real-provider and successful frozen imports for the other plugin groups on supported release platforms. All 47 formats have offline real-parser success/failure fixtures. |
| 02 — MTG imports | Partial — source implemented; release checks open | Installed-app checks on Windows/Linux and optional public-deck service checks. Frozen macOS custom JSON/CSV front/back imports pass. |
| 03 — MTG preferences and tokens | Partial — source implemented; release checks open | Live-provider and installed-platform checks. Source tests cover shared CLI selection, preference precedence, token copies/deduplication, stale results, and manual-choice retry. Token failures retry with their source row. |
| 04 — Cutting templates | Partial — source implemented; release checks open | Installed Windows/Linux and active-batch quit checks. macOS frozen template save and runtime PDF/calibration catalog use pass. |
| 05 — Studio conversion | Partial — source implemented; Windows acceptance open | Real Studio conversion, output dimensions/cut paths, calibration reuse, stop/fail-safe behavior, and frozen Windows helper checks. Mocked checks cannot certify automation. |
| 06 — Printer calibration | Partial — source implemented; release checks open | Installed Windows/Linux and physical printer alignment. CLI/worker output, old saves, front/back transforms, rendered sheets, and macOS frozen generation pass. |
| 07 — Text translation | Partial — source implemented; release checks open | Installed Windows/Linux checks. Source IPC and frozen macOS custom-paper/quality-zero generation pass. |

These are implementation records, not a claim that all platform acceptance conditions are complete.

## 3. Test Coverage

- Final full Node suite: **178 passed** with Node 22.23.4, including quit waiting, repeated quit, and bounded cleanup regressions.
- Broad Python source run: **728 passed, 2 skipped, 24 sub-tests passed**. Provider checks use local fixtures. The two skips are opt-in frozen helper checks, which release builds now run. After the final MTG cache lifecycle fixes, **40 targeted worker/import/preference tests passed** without warnings.
- Portable worker validation/recovery checks: **14 passed** using the real source worker. Container tests can now select a helper through `CARD_MAKER_PDF_WORKER` instead of requiring `/app` on every host.
- Electron checks passed for game plugins, MTG imports/preferences, existing card list/printing selector, templates, Studio controls, translation, printer calibration, and custom-template-to-calibration integration. New tests cover export control locking, cancelled dialogs, repeated jobs, prompt replies, and stop.
- Isolated macOS native helpers were built without replacing the project virtual environment. **Two frozen parity tests passed** with Python removed from child PATH: card custom imports and template → runtime catalog → PDF → calibration → translation. After the final rebuild, the frozen card test passed again with released-image refetch and EOF cleanup. The four tested macOS helpers were staged in the ignored `GUI/bin` directory, and binary verification passed.
- Letter and A4 calibration PDFs at 72 and 150 PPI were rendered and reviewed. CSS build and diff whitespace checks passed.
- New Node/Python/UI checks are in the runners. Frozen parity is opt-in with `CARD_MAKER_PARITY_BIN_DIR`; the integration container supplies it. No real Windows Studio or physical printer check was run.

## 4. Action Items

1. On Windows with Studio installed, run the checks in `05-studio-conversion-completion-summary.md`; inspect actual `.studio3` dimensions and cut paths.
2. Build and install releases on each target OS without local Python; isolated macOS helper checks do not replace an installed-app check. Check helper startup, image import/export, custom layouts, translation, calibration, and quit during active work.
3. Check representative live game sources and MTG deck URLs. Keep provider failures separate from offline correctness results.
4. Print calibration sheets and verify alignment on the target printer. Do not infer physical alignment from a PDF render.
