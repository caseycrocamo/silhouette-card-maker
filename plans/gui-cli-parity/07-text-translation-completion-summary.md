# Text translation completion record

## Implemented

- Open a Markdown file, edit its contents, and keep paste support. Cancelling either file dialog keeps the current text and output path. Generation does not write to the source file.
- Select an output PDF path. Show the returned path and a link to the existing PDF viewer.
- Load current paper choices from PDF worker capabilities, including papers saved through Tools. Pass the extra-layout environment before the translation CLI imports its choices.
- Preserve quality 0 and 100. Validate whole-number PPI and quality in the renderer and service. Disable repeat submission during a job.
- Generate a sibling temporary PDF, check its PDF header and end marker, then atomically replace the selected output. Failed generation, malformed output, and failed replacement leave an earlier PDF unchanged.
- Use a unique temporary Markdown input for each job and remove it after success, launch failure, conversion failure, or missing output. Packaged builds require the native helper; development can use either project virtual environment.
- Use the shared layout engine for custom paper sizes without a bundled text-box grid. Keep existing bundled text-box grids unchanged.
- Main-process integration is in `GUI/Utilities/parityIpc.js`, with trusted callers and the existing job-activity gate.

## Verification

- `node --test tests/translationService.test.js` with Node 20.20.2: 13 passed.
- `venv/bin/python -m pytest tests/test_translation_gui_parity.py test/test_text_box_merge.py -q`: 9 passed. Checks include custom papers, quality 0/100, Unicode paths, unchanged source text, multiple pages, dimensions, rendered content, malformed CLI values, and all bundled papers.
- `GUI/node_modules/.bin/electron tests/text-translation-smoke.cjs`: passed with actual IPC and isolated source workers. Checks include cancelled dialogs, opened/edited Markdown, custom paper, selected Unicode destination, two jobs, quality 0/100, source preservation, distinct temporary inputs, cleanup, and the PDF viewer link.
- The source-worker smoke uses native ARM Python on Apple Silicon when Electron runs under Rosetta. It does not alter production launch behavior.
- `git diff --check` passed for translation files.

## Remaining release checks

- Rebuild/stage native helpers and verify translation in a packaged app without local Python on release platforms. The source-worker smoke is not proof of packaged operation.
- Full suite and combined-diff verification belong to the integration owner.
