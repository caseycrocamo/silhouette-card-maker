# Plan 02: MTG file and URL imports

## Goal and approach

Expose every MTG CLI format: simple, MTGA, MTGO, Archidekt, Deckstats, Moxfield, CubeCobra CSV, Scryfall JSON, MPCFill XML, and URL. Reuse [plugins/mtg/deck_formats.py](/Users/braeburn/repos/silhouette-card-maker/plugins/mtg/deck_formats.py) and the Plan 01 import service. Preserve direct custom images and per-slot backs.

## Dependencies and contract

Start after Plan 01 shared card-service and renderer files are merged. Extend its capabilities with MTG formats. An import result must support both a Scryfall printing and an external custom image. A custom image must not be assigned a false Scryfall identity or offered a printing panel. Preserve the source document separately from the normalized list; search and retry must not reinterpret CSV/XML as plain text.

## File ownership and work

| Subagent | Owned files | Work |
|---|---|---|
| A — Backend | Proposed [plugins/gui_adapters/mtg.py](/Users/braeburn/repos/silhouette-card-maker/plugins/gui_adapters/mtg.py); [plugins/mtg/deck_formats.py](/Users/braeburn/repos/silhouette-card-maker/plugins/mtg/deck_formats.py) | Adapt every format. Preserve parser behavior while exposing structured errors. Fetch direct CubeCobra/Scryfall image URLs and MPCFill assets into staging. Keep MPCFill slot order, repeated copies, and custom backs. Keep CLI behavior intact. |
| B — Import controls | Proposed [GUI/shared/cardList/importControls.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/importControls.js); [GUI/CardList/decklist.html](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/decklist.html), [GUI/CardList/decklist.js](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/decklist.js), [GUI/shared/cardList/sessionStore.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/sessionStore.js) | Add format selection, file picker, text input, and URL input. Show format-specific help. Persist source type, format, and original source. Dirty state must invalidate old results. |
| C — Results and export | [GUI/CardList/adapters/mtg.js](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/adapters/mtg.js), [GUI/shared/cardList/controller.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/controller.js), [GUI/shared/cardList/resultsGrid.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/resultsGrid.js) | Accept imported entries. Keep manual printing changes for Scryfall entries. Disable that action for custom art with a clear label. Keep original paired backs and quantity during export and retry. |
| D — Tests | Proposed [tests/test_mtg_gui_imports.py](/Users/braeburn/repos/silhouette-card-maker/tests/test_mtg_gui_imports.py), [tests/mtgImports.test.js](/Users/braeburn/repos/silhouette-card-maker/tests/mtgImports.test.js), [tests/mtg-imports-smoke.cjs](/Users/braeburn/repos/silhouette-card-maker/tests/mtg-imports-smoke.cjs) | Add fixtures for each format, direct-image sources, custom backs, and errors. |
| Integration owner | [card_worker.py](/Users/braeburn/repos/silhouette-card-maker/card_worker.py), [plugins/gui_games.py](/Users/braeburn/repos/silhouette-card-maker/plugins/gui_games.py), [GUI/Utilities/ipcHandlers.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/ipcHandlers.js), [GUI/Utilities/cardWorkerClient.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/cardWorkerClient.js), packaging and runner files, docs | Register MTG capabilities, file read/size validation, long-running URL import handling, lazy dependencies, and test commands. |

## Sequence

1. A and C agree on entry provenance, source IDs, token-free import results, and face representation. Publish JSON fixtures.
2. A builds parsers while B builds controls and C updates result handling.
3. Merge simple/text formats first. Add CSV, JSON, XML, then URL imports.
4. Add durable source references for retry. Retry only failed entries where possible; do not silently reimport a whole successful deck.
5. Integrate packaging and verify all imported faces through PDF creation.

## Verification and acceptance

Run MTG parser tests in [test/test_mtg_plugin.py](/Users/braeburn/repos/silhouette-card-maker/test/test_mtg_plugin.py), the new backend suite, `npm test`, and the new Electron smoke. Stub all remote services in automated tests. Include section headers, sideboards, foil suffixes, Unicode paths, duplicate entries, malformed documents, unsupported URLs, and empty decks. Compare slot order and back pairing with CLI fixtures. Check that failure does not change existing exported images. Run an optional live import for an available public deck and record service failures separately.

## Decisions

Keep explicit format selection; do not rely on automatic guessing. Preserve the existing simple GUI syntax. Import does not export until the user chooses the existing export or next action. Plan 03 adds selection preferences after this import route is stable.

## Execution rules

- This is an implementation plan. No feature code has been changed.
- Each subagent owns only the files assigned to it. Agents share the codebase. Do not revert another agent's edits. The integration agent resolves shared-file changes after each handoff.
- Reuse `GUI/shared/` controls and `GUI/styles/tailwind.css`. Use `paper-button` for HTML and `createButton` from `GUI/shared/button.js` for JavaScript. Keep button states in the shared component.
- Use argument arrays and `shell: false` for processes. Keep logs separate from worker JSON. Keep jobs inside the existing job-activity gate so updates cannot restart the app during work.
- Use temporary folders and stub network services for automated tests. Add new test files to the applicable test runner. Run live service checks separately.
- Finish with a review of the full diff and the acceptance checks below.
