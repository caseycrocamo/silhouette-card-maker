# Pokémon GUI and shared card-list components

## TL;DR

Add Pokémon to the desktop app. Use one shared card-list page for MTG and Pokémon. Extract the MTG controller, result views, saved state, and image export service. Keep parsing, provider requests, printing selection, and face rules in game adapters.

Reuse the existing Pokémon Python plugin for image lookup. Add a small card worker so the GUI can use it in both source and packaged builds. Do not copy the Limitless URL rules or old-set map into JavaScript. Keep the PDF worker focused on PDF work.

This document is a plan. No app code has been changed. Research uses the current working tree, which contains changes to PDF settings and other files. Keep those changes during implementation.

## Decisions

- Scope: Pokémon desktop GUI support. The command-line Pokémon plugin already exists.
- First release: Limitless text lists for Pokémon TCG and Pocket, as supported by the plugin. Do not add a format switch when both use the same syntax. Do not enforce tournament deck size or card limits; users can print partial lists.
- Require quantity, card name, set code, and card number. Ignore blank lines, known category headers, and a known total line. Report all other invalid lines with line numbers. Keep collector numbers as strings, including leading zeroes.
- Use exact set and number lookup. The current final name/number search selects its first result; this can silently change the requested printing. For the GUI, accept that fallback only when a set match can be verified. Otherwise report a missing image. Keep existing CLI behavior by default until a separate change is approved.
- Pokémon starts with fronts only. It has no MTG face-flip or printing picker. Users can edit set and number in the list. The existing PDF page can enable a common back image. Do not ship a Pokémon back asset.
- MTG keeps its printing picker, quantities, front-only mode, and paired double-faced mode. Group card-list and Text Translation actions inside one MTG game card on Home. Use the former subtext as the main CTA: “Search cards and select printings” for MTG and “Use a Limitless deck list” for Pokémon. Remove the duplicate subtext. Text Translation keeps its current page and behavior.
- Keep the current shared 1–2–3 navigation: numbered circles, connecting lines, active pill label, hover expansion, and Settings icon. Do not replace it with tabs or add a brand label. Only update route resolution for the selected game.
- Use the existing slate palette, paper surfaces, shared buttons, and input styles. Mocks change the page layout, not the visual system.
- Do not add AI model calls or a second card database for this feature.

## UI mocks

All PNGs are 1440 × 1100. Card art is a labeled placeholder. These are layout proposals, not app screenshots.

| Mock | Purpose |
| --- | --- |
| [Choose game](mocks/01-choose-game.png) | Add Pokémon beside one MTG card with card-list and Text Translation actions. Use descriptive CTA labels in place of subtext. |
| [Pokémon ready](mocks/02-pokemon-ready.png) | Shared editor, quantity badges, exact print labels, results, and PDF handoff. |
| [Pokémon errors](mocks/03-pokemon-errors.png) | Line error and failed image with retry. Disable Next until all entries are ready. |
| [MTG shared page](mocks/04-mtg-shared.png) | Same shell with MTG printing controls and workflow choices. |

The desktop proposal puts the input beside the results. The ready mock summarizes a fourth result to keep the sheet small; the app must show every card in a wrapping, scrollable grid. Below 1024 px, stack the input, results, workflow, and Next action. At 375 px, use one result column if two cards would make their controls too narrow. Keep reading order equal to keyboard order.

Empty state: show syntax help and disable Export and Next. Loading state: show entry progress, disable duplicate submission, and allow input changes to cancel the active search. Dirty state: mark results stale and disable Next. Ready state: show entry count and expanded copy count. Error state: preserve successful cards; show line errors and a retry action for failed downloads. Do not silently omit a card.

## Steps

### Phase 1 — Record the MTG contract

1. Extend the existing MTG test harness before moving code. Record parsing, text export, selected printing, copy counts, both-face export, failure rollback, and Create PDF handoff. Keep the existing known parser behavior during extraction; isolate its documented numeric-name and MDFC parsing issues for a later fix unless required by a new test.
2. Record current routing and storage behavior. Preserve the MTG URL as a thin compatibility page that opens the shared page with the MTG game ID. Keep old bookmarks and Text Translation links working.

Dependency: complete this phase before moving the MTG implementation.

### Phase 2 — Extract the shared flow

3. Add `GUI/CardList/decklist.html` and a small bootstrap script. Put common views and logic in `GUI/shared/cardList/`. Use simple CommonJS modules and DOM components, consistent with the existing Electron app; no UI framework is needed.
4. Define a normalized card entry with a stable row ID, source line, requested name, positive integer quantity, requested printing, selected printing, status, and error. A printing has a stable ID, display name, set code, collector number, preview faces, and image references. Keep provider payloads inside adapters. Shared views must not inspect Scryfall fields.
5. Extract these modules:

| Proposed module | Responsibility |
| --- | --- |
| `gameRegistry.js` | Game IDs, names, routes, syntax help, examples, defaults, and capabilities. Reject unknown IDs. |
| `controller.js` | Parse → resolve → render → export flow; search generation IDs; dirty, loading, ready, and error states. Ignore stale requests after input edits or navigation. |
| `sessionStore.js` | Versioned, game-scoped draft, results, and workflow state. Migrate `mtg-decklist` and `mtg-cards`; validate saved JSON and re-resolve invalid cache entries. |
| `decklistInput.js` | Labeled textarea, syntax help, line errors, search and text export actions. |
| `resultsGrid.js` and `cardPreview.js` | Responsive cards, quantity, image loading state, retry, and optional face flip. Use DOM nodes and `textContent` for untrusted text. |
| `printingPicker.js` | Optional printing selection with stable IDs, stale-request guard, and rollback after a failed change. |
| `workflowSelector.js` | Render the modes supported by the game. Reuse MTG wording only for MTG. |
| `imageExport.js` | Expand copies, plan names, stage images, validate responses, report progress, and commit files. |

6. Move MTG parsing, `fetchCardData()`, print lookup, list formatting, and face rules to `GUI/CardList/adapters/mtg.js`. Define adapter methods for parse, resolve, serialize, and export-plan creation; printing lookup is optional. Preserve the current MTG set picker behavior during extraction. A full collector-number picker is separate scope.
7. Use one serializer for textarea regeneration and text download. Keep raw input while it has errors. Save drafts on input, including an empty draft. Scope workflow state by game. Set the existing `onlyFronts` handoff only when preparing the active game's PDF session.

Dependency: validate MTG on the shared page before connecting Pokémon. Shared views can be built beside the MTG adapter once the normalized contract is fixed.

### Phase 3 — Reuse the Pokémon backend

8. Split image resolution from copy writing in `plugins/pokemon/limitless.py`. Add a resolver that returns bytes, MIME type, source, and exact printing metadata. Keep `fetch_card()` as the CLI wrapper that writes copies. Share the existing URL templates and old-set map.
9. Add a structured parse result in `plugins/pokemon/deck_formats.py`: entries, ignored known headers, and line errors. Keep `parse_deck()` and its callback contract for current callers. Handle CRLF, Unicode names, apostrophes, repeated spaces, zero or negative quantities, missing identifiers, and Pocket set codes. Do not discard unrecognized lines as the current parser does.
10. Add top-level `card_worker.py` with a versioned newline-delimited JSON protocol. Support parse, resolve, and cache release operations. Each response includes a request ID. Send logs to stderr. Resolve one unique printing once per job; quantities do not trigger duplicate downloads. Stage images in an app-owned cache and return opaque cache IDs plus local preview URLs. The main process validates IDs and paths. Do not return raw image bytes in JSON.
11. Add `GUI/Utilities/cardWorkerClient.js` and card IPC handlers. Use the PDF worker client as a lifecycle reference, not a module to copy in full. Extract a small shared process transport only where startup, framing, crash handling, or shutdown logic is truly identical. Use `jobActivity.run()` for lookup and final export jobs so updates cannot interrupt them. Stop the worker on app quit; fail queued jobs on a crash; restart on the next request without replaying writes.
12. Fix resolver behavior needed by the GUI: explicit request timeouts, bounded retries for transient failures, Retry-After handling, image decoding checks, and exact-print verification. Cache misses by complete printing identity, not by set: one missing image must not block every later card in that set. Namespace TCG and Pocket cache identities. Limit fallback search requests independently from direct CDN requests. Keep no-key use; do not embed an API key.
13. Add `GUI/CardList/adapters/pokemon.js` as a thin IPC adapter. Consume Python parse and resolution results. Serialize the canonical Limitless lines, preserve exact identifiers, and return one front image per selected printing to the shared export service. Restore cached rows only if cache files still exist; otherwise resolve them again.

Dependency: steps 8–12 can run beside Phase 2 after the shared contract is fixed. Step 13 depends on both.

### Phase 4 — Wire navigation and safe PDF export

14. Add Pokémon to Home. Group the MTG card-list and Text Translation actions in one MTG game card. Label the main buttons “Search cards and select printings” and “Use a Limitless deck list”; remove the duplicate subtext. Keep the translation action linked to its existing page; do not show it as a separate game choice. Save `activeGame` in the shared session store. Keep the current navbar appearance and interactions. Resolve navbar step 2 from that game on every page, including Settings and Create PDF. Direct entry with no game uses MTG for compatibility. An explicit page game ID takes precedence over saved state.
15. Keep output folders global for compatibility with Create PDF. Before export, show the existing-image choice with explicit Replace, Add, and Cancel actions. Replace must not clear old images until all new images are staged. Add must allocate names that cannot collide. Count PNG, JPEG, and WebP images; decode and normalize exports to PNG. Preserve non-image files and the common back directory.
16. Use adapter export plans to keep MTG paired names and front-only multi-face behavior. Use sanitized names plus unique sequence IDs; never trust provider names as paths. Check HTTP status and image decoding before committing. Record written files, roll back a failed commit, and preserve prior files for Replace rollback. On failure, stay on the page and show retry. Block Next for stale, empty, or unresolved lists. Navigate only after a complete commit.
17. Reuse `getFrontDir()`, `getDoubleSidedDir()`, and the current PDF page. Pokémon's handoff sets `onlyFronts=true` and does not overwrite the saved MTG mode. Replacement clears stale double-faced images only after the user selects Replace. Add preserves existing image files by design.
18. Update Tailwind scanning for CardList and adapter paths. Reuse `paper-input`, `paper-element`, and `paper-surface`. All buttons, including retry, flip, and printing actions, use shared `paper-button` classes or `createButton()` and shared size variants. Add status announcements, visible labels, keyboard operation, and focus after errors.

### Phase 5 — Package, document, and verify

19. Confirm the discovered top-level entrypoints include `card_worker.py`. Include plugin modules and decoder dependencies in the frozen worker. Update copy and release checks for the new worker binary. Test macOS, Windows, and Linux packaged paths without a local Python installation. Do not run the current build script as a casual check: it deletes and recreates `venv`.
20. Update GUI and Pokémon usage documentation. Include syntax examples, exact-print failure messages, Pocket image-quality limits, common-back behavior, and the new game navigation.

## Relevant files

All paths below are under `/Users/braeburn/repos/silhouette-card-maker/`.

| Current file | Reuse or change |
| --- | --- |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/MagicTheGathering/decklist.js` | Extract `fetchCardData`, `regenerateTextboxFromCardData`, `renderCardResults`, form lifecycle, printing rollback, and quantity/face export rules. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/MagicTheGathering/decklist.html` | Shared shell, actions, results, workflow, and compatibility route. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/Home/home.html` | Add game choice. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/shared/navbar.js` | Keep the existing step UI and interactions. Update only the fixed MTG step-2 link and MTG-only active-path check. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/shared/button.js` | Reuse `createButton()` and shared sizes. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/styles/tailwind.css` | Shared controls, palette, and result styles. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/shared/loadingOverlay.js` | Reuse export progress overlay. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/shared/constants.js` | Use development and packaged user-data paths. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/CreatePDF/create.js` | Keep the `onlyFronts` handoff and current settings model. |
| `/Users/braeburn/repos/silhouette-card-maker/plugins/pokemon/deck_formats.py` | Reuse Limitless parsing; add structured validation. |
| `/Users/braeburn/repos/silhouette-card-maker/plugins/pokemon/limitless.py` | Reuse image sources, old-set map, resolver, and CLI wrapper. |
| `/Users/braeburn/repos/silhouette-card-maker/plugins/pokemon/fetch.py` | Preserve CLI entry and callbacks. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/pdfWorkerClient.js` | Reference framing, executable paths, and shutdown; avoid coupling card work to PDF work. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/jobActivity.js` | Track requests and export through `run()`. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/ipcHandlers.js` | Add validated card operations. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/main.js` | Worker lifecycle and shutdown. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/tailwind.config.js` | Include new shared page sources. |
| `/Users/braeburn/repos/silhouette-card-maker/check_and_build_entrypoints.js` | Worker discovery, copy, and freshness checks. |
| `/Users/braeburn/repos/silhouette-card-maker/GUI/verifyBinaries.js` | Include the card worker in release verification. |
| `/Users/braeburn/repos/silhouette-card-maker/tests/decklistPrinting.test.js` | Preserve printing regression coverage while moving it to the shared contract. |
| `/Users/braeburn/repos/silhouette-card-maker/test/test_pokemon_plugin.py` | Extend offline parser and resolver fixtures. |

## Verification

- Run `npm test` before extraction and after each shared-flow phase. Add shared controller, session, export, and Pokémon adapter tests to the root test command.
- Run `python3 -m pytest test/test_pokemon_plugin.py -m 'not integration'`. Add offline fixtures for all fallback paths, strict identity checks, category headers, totals, Pocket, Unicode, leading zeroes, errors, timeouts, and invalid image responses.
- Add worker tests for JSON framing, correlated errors, unknown operations, invalid paths, cache cleanup, crash/restart, cancellation, and app shutdown. Use injected transports; offline tests must not require public APIs.
- Assert that printing changes preserve MTG quantity and survive resubmit. Failed changes keep the old printing. Older searches must not replace newer input.
- Assert exact output counts for Pokémon quantities and MTG paired faces. Test Replace, Add, Cancel, WebP conversion, duplicate names, failed downloads, commit rollback, and packaged user-data paths with temporary folders.
- Run `npm run build:css`. Open Home → Pokémon → Create PDF → Card List. Then switch to MTG and back. Confirm drafts, printing mode, active step, and selected game remain correct. Confirm the existing numbered circles, active pill, connectors, hover expansion, and Settings icon are preserved.
- Test empty, loading, dirty, ready, parse-error, download-error, and export-error states at 1440, 1024, and 375 px. Check keyboard-only use, screen-reader labels, long names, text zoom, and focus after retry.
- Run existing PDF settings and worker checks from the current tree. Confirm its common-back control and saved calibration still work after a Pokémon handoff.
- After an intentional entrypoint build and copy, run `npm run check:entrypoints` and the release verification command. Launch a packaged build on each supported OS without Python installed.
- Keep live provider checks opt-in. Fetch one modern TCG card, one Pocket card, and one mapped old-set card. Check the printed image resolution, not only HTTP success. A provider outage must yield a useful per-card error.

Completion requires both games on the shared page, no duplicated page controller or export loop, unchanged MTG regression results, correct Pokémon copy counts, and a packaged worker that needs no local Python.

## Further considerations

- Provider availability remains an external dependency. The repository proves the current source rules, not future CDN uptime. Validate representative live images before release. Do not add a substitute provider silently.
- Pocket currently uses an `SM.webp` source. Show a quality notice when resolution is low for the chosen print size. Higher-resolution Pocket support needs a verified source and is separate scope.
- Pokémon printing search, card-name-only search, file import, deck legality, and a general plugin GUI system are deferred. The adapter contract leaves room for them without adding controls now.
- Keep the new card worker separate from PDF jobs. A universal worker or a general plugin framework would add scope without reducing the two current adapters.

## External references

- [Limitless tools](https://www.limitlesstcg.com/tools): reference for written deck-list input and image tools. The local plugin defines this release's supported syntax.
- [Pokémon TCG API rate limits](https://docs.pokemontcg.io/getting-started/rate-limits/): fallback API requests have service limits. Check current responses and honor throttling; do not assume CDN pacing is sufficient for search requests.

## Planning artifacts

The PNG source is [mocks/render.py](mocks/render.py). It uses Pillow and local fonts. It does not load the app or fetch card art. These artifacts do not validate a working implementation.
