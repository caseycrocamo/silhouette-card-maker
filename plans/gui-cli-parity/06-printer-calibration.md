# Plan 06: Full printer offsets and calibration sheets

## Goal and approach

Complete the Settings printer calibration workflow. Add rotation, offset PPI, output destination, one-run overrides, and generation of sheets for one or all configured paper sizes. Reuse the existing PDF worker and preserve saved X/Y values.

## Current code constraints

[pdf_worker.py](/Users/braeburn/repos/silhouette-card-maker/pdf_worker.py) already forwards angle, PPI, and output path to the offset command. [GUI/Utilities/pdfWorkerClient.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/pdfWorkerClient.js) forwards angle, but the IPC handler drops it. Settings only edits X/Y. Saved angle is preserved by the current save handler. [generate_calibration.py](/Users/braeburn/repos/silhouette-card-maker/generate_calibration.py) runs on import and writes to a relative directory; it also saves with a fixed 300 resolution. Refactor it before importing it into the worker.

## File ownership and work

| Subagent | Owned files | Work |
|---|---|---|
| A — Calibration backend | [generate_calibration.py](/Users/braeburn/repos/silhouette-card-maker/generate_calibration.py); proposed [tests/test_calibration_generation.py](/Users/braeburn/repos/silhouette-card-maker/tests/test_calibration_generation.py) | Extract a callable accepting paper selection, output folder, and validated PPI. Add a main guard and preserve standalone all-paper behavior. Keep dot labels, sign conventions, fixed timestamp behavior, and physical dimensions. Set PDF resolution from the selected PPI. Return generated paths. |
| B — Offset UI | [GUI/Settings/settings.html](/Users/braeburn/repos/silhouette-card-maker/GUI/Settings/settings.html), [GUI/Settings/settings.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Settings/settings.js); proposed [tests/printerCalibration.test.js](/Users/braeburn/repos/silhouette-card-maker/tests/printerCalibration.test.js) | Add saved angle, per-run X/Y/angle overrides, positive whole PPI, output picker, and sheet generation controls. Explain positive X/right, positive Y/up, and positive angle/clockwise in the back-page frame. Keep save separate from apply. Persist zero values correctly. |
| C — Worker client | [GUI/Utilities/pdfWorkerClient.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/pdfWorkerClient.js); proposed [tests/printerOffsetClient.test.js](/Users/braeburn/repos/silhouette-card-maker/tests/printerOffsetClient.test.js) | Forward output path and PPI; add sheet-generation and paper-capability helpers. Keep existing defaults and request serialization. |
| D — Acceptance tests | Proposed [tests/printer-calibration-smoke.cjs](/Users/braeburn/repos/silhouette-card-maker/tests/printer-calibration-smoke.cjs), [tests/test_printer_offset_parity.py](/Users/braeburn/repos/silhouette-card-maker/tests/test_printer_offset_parity.py) | Compare CLI and worker results, old offset files, generated sheet dimensions, and end-to-end UI paths. |
| Integration owner | [pdf_worker.py](/Users/braeburn/repos/silhouette-card-maker/pdf_worker.py), [GUI/Utilities/ipcHandlers.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/ipcHandlers.js), [GUI/shared/constants.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/constants.js), existing worker tests, build and runner files, docs | Forward angle through IPC, validate all numeric fields including finite angle, save all three offsets atomically, expose papers from merged layouts, add calibration worker command, dialogs, user-data destinations, and packaged font/data inclusion. |

## Sequence

1. Agree on request fields and saved offset schema. Missing angle in old files means zero; never erase a valid saved angle when a field is absent.
2. A refactors sheet generation while B builds controls and C updates client requests.
3. Integrate worker dispatch and Settings. Apply without save must leave saved offsets unchanged.
4. Check offsets on both calibration sheets and ordinary PDFs. Confirm the Create PDF load-offset option applies rotation as well as X/Y.

## Verification and acceptance

Run `python3 -m unittest discover -s tests`, existing offset/PDF tests under `test/`, `npm test`, and the new Electron smoke. Test zero/negative X/Y, fractional positive/negative angle, default/custom PPI, input and output paths with Unicode, invalid inputs, old JSON files, and no-save overrides. Check that only back pages move and front pages remain intact. Render calibration sheets at two paper sizes and PPIs and inspect dots, labels, clipping, and measured physical size. Verify packaged operation without Python and without writing to bundled calibration files.

## Decisions

This supersedes remaining work in the older offset-calibration plan. Studio mouse-position calibration belongs to Plan 05. Sheet generation uses the current merged layout configuration, including custom paper sizes from Plan 04.

## Execution rules

- This is an implementation plan. No feature code has been changed.
- Each subagent owns only the files assigned to it. Agents share the codebase. Do not revert another agent's edits. The integration agent resolves shared-file changes after each handoff.
- Reuse `GUI/shared/` controls and `GUI/styles/tailwind.css`. Use `paper-button` for HTML and `createButton` from `GUI/shared/button.js` for JavaScript. Keep button states in the shared component.
- Use argument arrays and `shell: false` for processes. Keep logs separate from worker JSON. Keep jobs inside the existing job-activity gate so updates cannot restart the app during work.
- Use temporary folders and stub network services for automated tests. Add new test files to the applicable test runner. Run live service checks separately.
- Finish with a review of the full diff and the acceptance checks below.
