# Plan 07: Text translation file and paper options

## Goal and approach

Bring the translation page to CLI parity: open a Markdown file, keep paste/edit support, choose an output PDF path, list all configured paper sizes, and honor compression quality zero. Keep existing PPI and quality controls.

## Dependencies and current constraints

The page currently lists five paper sizes in HTML and sends a fixed filename. IPC writes `entries.md` to the shared deck-list folder and uses `options.quality || 75`, which changes zero to 75. The CLI loads configured paper sizes when its module is imported. The process must receive the same extra-layout environment as PDF creation before it imports the CLI module.

Implement after Plans 04 and 06 changes to the shared worker, layout catalog, and IPC are merged. No dependency on the card import projects.

## File ownership and work

| Subagent | Owned files | Work |
|---|---|---|
| A — Page | [GUI/MagicTheGathering/text_translation.html](/Users/braeburn/repos/silhouette-card-maker/GUI/MagicTheGathering/text_translation.html), [GUI/MagicTheGathering/text_translation.js](/Users/braeburn/repos/silhouette-card-maker/GUI/MagicTheGathering/text_translation.js) | Add Open Markdown and output controls. Populate papers from merged capabilities, preserve edits on cancelled dialogs, disable duplicate submission, and show the returned output path. Keep integer and range validation consistent with CLI. |
| B — Translation service | Proposed [GUI/Utilities/translationService.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/translationService.js), [tests/translationService.test.js](/Users/braeburn/repos/silhouette-card-maker/tests/translationService.test.js) | Extract launch and file handling from IPC. Use nullish/default checks so quality zero survives. Create unique temporary inputs, preserve the selected source file, pass explicit output path and extra-layout environment, and clean temporary files on success/failure. Keep packaged executable and development fallback behavior. |
| C — Verification | Proposed [tests/text-translation-smoke.cjs](/Users/braeburn/repos/silhouette-card-maker/tests/text-translation-smoke.cjs), [tests/test_translation_gui_parity.py](/Users/braeburn/repos/silhouette-card-maker/tests/test_translation_gui_parity.py) | Test file open, paste, custom papers, selected output, quality zero, PPI, error handling, and repeated jobs. |
| Integration owner | [GUI/Utilities/ipcHandlers.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/ipcHandlers.js), shared dialog/catalog helpers, [translated_text_boxes_to_pdf.py](/Users/braeburn/repos/silhouette-card-maker/translated_text_boxes_to_pdf.py) only if needed, existing packaging tests, runners, docs | Delegate IPC to the service, validate trusted callers and inputs, wire capabilities, and ensure font/mana assets and extra layouts reach the packaged process. |

## Sequence

1. B publishes a translation request with Markdown text, selected output path, paper ID, PPI, and quality; response includes actual PDF path and logs.
2. A implements the UI while B implements the service. C writes tests against the request fixtures.
3. Integrate dynamic papers and file dialogs. Reuse the existing PDF viewer.
4. Verify translation behavior for a custom paper added through Plan 04 in the current session.

## Verification and acceptance

Run `npm test`, the new Python parity suite, and the new Electron smoke. Use temporary Markdown and output files with Unicode names. Test quality 0 and 100, minimum and default PPI, blank Markdown, malformed values, cancelled dialogs, output failure, worker/process failure, and two consecutive jobs. Confirm source files are unchanged and temporary inputs are removed. Render a representative PDF with mana symbols, multiple entries, headings, and page breaks. Run one packaged test without local Python.

## Decisions

Use open-file-plus-edit behavior; generation reads the editor content. Do not overwrite the opened Markdown file. Match the CLI paper list and compression values without adding translation-model API calls.

## Execution rules

- This is an implementation plan. No feature code has been changed.
- Each subagent owns only the files assigned to it. Agents share the codebase. Do not revert another agent's edits. The integration agent resolves shared-file changes after each handoff.
- Reuse `GUI/shared/` controls and `GUI/styles/tailwind.css`. Use `paper-button` for HTML and `createButton` from `GUI/shared/button.js` for JavaScript. Keep button states in the shared component.
- Use argument arrays and `shell: false` for processes. Keep logs separate from worker JSON. Keep jobs inside the existing job-activity gate so updates cannot restart the app during work.
- Use temporary folders and stub network services for automated tests. Add new test files to the applicable test runner. Run live service checks separately.
- Finish with a review of the full diff and the acceptance checks below.
