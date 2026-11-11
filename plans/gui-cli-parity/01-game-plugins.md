# Plan 01: Other game plugins

## Goal and approach

Expose all CLI game plugins through the shared card-list workflow. Reuse Python parsers and image fetchers. Add a structured import service rather than run each CLI against the repository image folders.

## Service contract — first handoff

The backend owner defines capabilities and import operations in the versioned card protocol. Capabilities list game ID, label, formats, input kind (text, file, URL, or opaque deck code), source choices, scenario choices, and supported backs. Import accepts game, format, source input, and options. Return ordered entries, quantities, cached face IDs, and errors tied to source entries. Preserve the existing Pokémon operations during migration.

Imports use a temporary workspace. Only explicit export writes to the PDF source folders. Cache IDs refer only to worker-owned files. Distinguish a complete success, a partial result, and failure. Printed CLI errors must not become a false success.

## File ownership and work

| Subagent | Owned files | Work |
|---|---|---|
| A — Python service | [card_worker.py](/Users/braeburn/repos/silhouette-card-maker/card_worker.py); proposed [plugins/gui_imports.py](/Users/braeburn/repos/silhouette-card-maker/plugins/gui_imports.py) and [plugins/gui_games.py](/Users/braeburn/repos/silhouette-card-maker/plugins/gui_games.py) | Add protocol dispatch, lazy plugin loading, capabilities, staging, and cache registration. Capture parser errors and preserve order, quantity, and back pairing. Support source and scenario options. Do not change global output directories per request. |
| B — Plugin adapters | Proposed [plugins/gui_adapters/](/Users/braeburn/repos/silhouette-card-maker/plugins/gui_adapters) only | Add per-game wrappers around existing parsers and fetchers. Inventory each plugin's actual signature before writing a wrapper. If a source module needs a refactor, hand the exact change to A; do not edit outside this directory. |
| C — Renderer | [GUI/CardList/decklist.html](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/decklist.html), [GUI/CardList/decklist.js](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/decklist.js), [GUI/shared/cardList/gameRegistry.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/gameRegistry.js), [GUI/shared/cardList/sessionStore.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/sessionStore.js); proposed [GUI/CardList/adapters/plugin.js](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/adapters/plugin.js) | Replace the MTG-versus-Pokémon branch with adapter lookup. Show only valid input and option controls. Preserve drafts by game and format. Keep MTG printing selection available. Use the existing result and export paths. |
| D — Verification | Proposed [tests/test_gui_game_imports.py](/Users/braeburn/repos/silhouette-card-maker/tests/test_gui_game_imports.py), [tests/gamePlugins.test.js](/Users/braeburn/repos/silhouette-card-maker/tests/gamePlugins.test.js), [tests/game-plugins-smoke.cjs](/Users/braeburn/repos/silhouette-card-maker/tests/game-plugins-smoke.cjs) | Verify capability coverage, every adapter mapping, failure handling, backs, and session isolation with fixtures. |
| Integration owner | [GUI/Home/home.html](/Users/braeburn/repos/silhouette-card-maker/GUI/Home/home.html), [GUI/Home/home.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Home/home.js), [GUI/Utilities/cardWorkerClient.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/cardWorkerClient.js), [GUI/Utilities/ipcHandlers.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/ipcHandlers.js), [GUI/shared/cardList/imageExport.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/imageExport.js), build files, runners, docs | Wire trusted IPC and file dialogs. Add a Home entry for each supported game. Validate cache access. Ensure imported formats are decoded and converted to real PNG data before the existing exporter gives them `.png` names. Package all lazy imports and data. |

## Adapter inventory and sequence

B owns these plugin groups: altered, arkham_horror_lcg, ashes_reborn, bushiroad, digimon, echoes_of_astra, elestrals, final_fantasy, flesh_and_blood, grand_archive, gundam, keyforge, lorcana, lotr_lcg, netrunner, one_piece, riftbound, sorcery_contested_realm, star_wars_unlimited, and yugioh. This is 20 directory names; Bushiroad covers several games. Verify the earlier count claim against this explicit inventory rather than create a missing twenty-first plugin.

1. A publishes protocol fixtures and validation rules. B lists each DeckFormat and source option from the corresponding [plugins/<game>/fetch.py](/Users/braeburn/repos/silhouette-card-maker/plugins/<game>/fetch.py) and `deck_formats.py`.
2. A and B build the service and wrappers. C builds controls against the fixtures. D writes tests after the contract handoff.
3. Integrate one front-only game, one game with paired backs, and LOTR local back scans first. Then integrate all remaining adapters.
4. Preserve exact CLI meaning for URL versus file input, YDKE codes, Bushiroad links, image-source choices in Ashes/Riftbound, and LOTR scenario modes and local scans.
5. Package, run smoke checks, and document each game's supported input.

## Verification and acceptance

Run `python3 -m unittest discover -s tests`, `npm test`, and `npm run test:card-list-ui`. Add the new UI smoke to the runner. Test every advertised format with a fixture, including malformed input and partial network failure. Verify retry does not duplicate cards. Verify cancel or failed import leaves source folders unchanged. Test packaged imports with at least one front-only game and one paired-back game, without Python installed.

## Decisions

No new card services are required. Match the CLI's existing sources. Bulk imports can use staged files internally; the GUI still needs previews and explicit export. Keep the service extensible for Plans 02 and 03.

## Execution rules

- This is an implementation plan. No feature code has been changed.
- Each subagent owns only the files assigned to it. Agents share the codebase. Do not revert another agent's edits. The integration agent resolves shared-file changes after each handoff.
- Reuse `GUI/shared/` controls and `GUI/styles/tailwind.css`. Use `paper-button` for HTML and `createButton` from `GUI/shared/button.js` for JavaScript. Keep button states in the shared component.
- Use argument arrays and `shell: false` for processes. Keep logs separate from worker JSON. Keep jobs inside the existing job-activity gate so updates cannot restart the app during work.
- Use temporary folders and stub network services for automated tests. Add new test files to the applicable test runner. Run live service checks separately.
- Finish with a review of the full diff and the acceptance checks below.
