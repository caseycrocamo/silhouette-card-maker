# Plan 03: MTG selection preferences and tokens

## Goal and approach

Expose all MTG fetch flags: ignore supplied set and collector number, prefer older sets, ordered preferred sets, excluded sets, showcase, extra art, ordered language preferences, prefer Universes Beyond, exclude Universes Beyond, and related tokens. Use the same selection rules as the CLI.

## Dependencies and decisions

Start after Plan 02. Keep options in the current MTG session. A preference change marks resolved results as stale and requires a new search. Manual printing choices stay fixed until an explicit new search; saving options alone does not replace them. Preserve CLI precedence when explicit printing data is present. Reject contradictory Universes Beyond choices. Keep ordered language/set lists ordered.

## File ownership and work

| Subagent | Owned files | Work |
|---|---|---|
| A — Selection backend | [plugins/mtg/scryfall.py](/Users/braeburn/repos/silhouette-card-maker/plugins/mtg/scryfall.py); proposed [plugins/mtg/selection_options.py](/Users/braeburn/repos/silhouette-card-maker/plugins/mtg/selection_options.py); [plugins/gui_adapters/mtg.py](/Users/braeburn/repos/silhouette-card-maker/plugins/gui_adapters/mtg.py) | Extract reusable option validation and selection without changing CLI defaults. Forward every current flag. Add tokens to structured import results with parent identity and CLI-equivalent quantity/deduplication. Keep custom image imports outside Scryfall preference processing. |
| B — Controls | Proposed [GUI/shared/cardList/mtgPreferences.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/mtgPreferences.js); [GUI/CardList/decklist.html](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/decklist.html), [GUI/CardList/decklist.js](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/decklist.js), [GUI/shared/cardList/sessionStore.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/sessionStore.js) | Add shared-style controls, ordered list editing, reset action, validation, and option-specific help. Preserve options across navigation. Explain when supplied printing data wins. |
| C — Results | [GUI/CardList/adapters/mtg.js](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/adapters/mtg.js), [GUI/shared/cardList/controller.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/controller.js), [GUI/shared/cardList/resultsGrid.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardList/resultsGrid.js), [GUI/shared/cardImageCache.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/cardImageCache.js) | Include options in request/result identity. Separate token entries from parent entries. Preserve manual printing selection and face pairing. Export tokens through the normal image path and prevent duplicates on retry. |
| D — Tests | Proposed [tests/test_mtg_selection_options.py](/Users/braeburn/repos/silhouette-card-maker/tests/test_mtg_selection_options.py), [tests/mtgPreferences.test.js](/Users/braeburn/repos/silhouette-card-maker/tests/mtgPreferences.test.js) | Test all flags, precedence, ordered fallback, token deduplication, quantity, and stale requests. |
| Integration owner | [plugins/mtg/fetch.py](/Users/braeburn/repos/silhouette-card-maker/plugins/mtg/fetch.py), [plugins/gui_games.py](/Users/braeburn/repos/silhouette-card-maker/plugins/gui_games.py), [card_worker.py](/Users/braeburn/repos/silhouette-card-maker/card_worker.py), existing shared suites, runners, docs | Wire common option definitions into CLI and capabilities. Update protocol validation. Merge changes to existing printing tests and packaged dependencies. |

## Sequence

1. A records current Scryfall selection and token rules in fixture expectations. Do not invent a new ranking algorithm.
2. Publish the option schema and result fixtures. B and C then work in parallel.
3. Integrate preferences first, then related tokens. Keep retries keyed by options and source identity.
4. Check interaction with exact-printing selection, imported files, and custom image sources.

## Verification and acceptance

Run `python3 -m pytest test/test_mtg_plugin.py`, the new Python suite, `npm test`, and `npm run test:printing-selector-ui`. Cover each option independently and key combinations: exact printing plus preferences, ignore printing plus preferences, language fallback to English, excluded preferred set, and Universes Beyond conflict. Confirm matching CLI/GUI selections using recorded card fixtures. Verify token retries do not multiply output and manual selection keeps quantity.

## Execution rules

- This is an implementation plan. No feature code has been changed.
- Each subagent owns only the files assigned to it. Agents share the codebase. Do not revert another agent's edits. The integration agent resolves shared-file changes after each handoff.
- Reuse `GUI/shared/` controls and `GUI/styles/tailwind.css`. Use `paper-button` for HTML and `createButton` from `GUI/shared/button.js` for JavaScript. Keep button states in the shared component.
- Use argument arrays and `shell: false` for processes. Keep logs separate from worker JSON. Keep jobs inside the existing job-activity gate so updates cannot restart the app during work.
- Use temporary folders and stub network services for automated tests. Add new test files to the applicable test runner. Run live service checks separately.
- Finish with a review of the full diff and the acceptance checks below.
