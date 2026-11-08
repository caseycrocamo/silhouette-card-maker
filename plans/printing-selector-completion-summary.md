# Printing selector completion summary

Status: Completed on November 8, 2026.

Implemented the approved side panel from `02-printing-drawer-v2.png`. Three subagents built the component, connected it to the active shared card-list page, and tested the combined flow. They used the shared working tree. No branch merge was needed. The detached prunable worktree was unrelated and was left in place.

Concurrent Pokémon work moved MTG to `GUI/CardList/decklist.html?game=mtg`. The selector uses that route and keeps the legacy redirect. On wide screens the current deck stays visible beside the panel. Closing the panel restores the editor layout.

Every exact printing has its own preview and set metadata. The panel loads all result pages when opened. It supports search, sort, two-face previews, load retry, and image retry. A checkmark and outline show the choice without a Selected label. Apply keeps the exact collector number, quantity, order, export images, and session draft. Cancel, Close, and Escape discard the choice. Removed entries and stale requests cannot replace current data.

Shared buttons retain their existing style. Provider text uses DOM text nodes. API and image URLs are restricted to Scryfall HTTPS hosts. Requests stop on close and have a per-page timeout. Missing printable image data disables Apply. Callback errors remain in the panel.

## Validation

- Full Node suite: 103 tests passed with Node 20.20.2.
- Nine integration tests cover exact same-set variants, quantity, saved state, resubmit, stale callbacks, and image export with paired faces.
- Six helper tests cover pagination, malformed results, URL restrictions, cancellation, preview faces, and treatments.
- Real Electron fixture smoke passed for the active MTG route, previews without hover, draft isolation, Apply, cancellation, radio arrow keys, Escape, focus return, search, sort, two-face previews, retries, empty results, missing images, stale responses, and 375px layout.
- Desktop checks confirm that the card stays left of the panel and the editor returns after Apply.
- An Apply callback failure keeps the panel open, preserves the choice, and shows an error. Cancel still closes it without a commit.
- CSS build and whitespace checks passed. The implementation screenshot was inspected.

The screenshot uses local image and API fixtures. Live provider availability and Windows/Linux native packages were not tested in this selector task.

## Records

Agent records: `printing-selector-component-completion-summary.md`, `printing-selector-integration-completion-summary.md`, and `printing-selector-validation-completion-summary.md`.

Preview: `designs/printing-selector-concepts/implemented-side-panel.png`.

## Session image cache revision

Card images now use a main-process memory cache, shared by preview and export. The picker uses the same PNG source as the deck so Apply reuses the existing image. Renderer blob URLs avoid another image request when controls are rebuilt. Page navigation keeps the cached bytes. Closing all windows or quitting aborts pending downloads and clears the cache. Image requests bypass the disk cache. Failed requests are removed so Retry can load them again.

Validation: 109 Node tests passed. The Electron smoke passed with request counters: repeated previews download once, Apply uses the same blob URL without another request, page reload reuses cached bytes, and closing the last window starts a fresh cache. Six new unit tests cover reuse, session clearing, aborted and late requests, retry, invalid responses, and URL restrictions.

## Loading indicators and Unicode header fix

Shared loading spinners now appear on deck images, printing thumbnails, and the larger preview. They stop on load or failure. Card frames keep their size while loading. Reduced-motion settings disable the rotation.

The cache transport now reads Electron's response stream directly. This avoids an Electron 27 `net.fetch` crash when a response filename header contains a Unicode character such as ★. Image caching, URL checks, timeouts, cancellation, and the no-store policy remain in place.

Validation: 110 Node tests and the Electron selector smoke passed. The tests cover Unicode filename headers and pending image spinners. The Electron fixture includes the ★ header. CSS build and whitespace checks passed.

## Card image action

Removed the separate Change printing button. The MTG card image now opens the selector, with the italic reminder "Click a card image to change its printing." at the top of the page. The image uses the shared button component with an image size, a descriptive accessible name, and native keyboard support. Pokémon images keep their current behavior. The smoke covers image clicks, Space activation, the italic reminder, and removal of the text button. All 110 Node tests, the Electron smoke, and the CSS build passed.

## Configurable printing batches

The selector starts with 25 printing rows. Load more adds the next batch and disappears at the end. Images for later rows do not load until those rows are shown. Later API pages load only when needed. Search and sort can read remaining metadata to keep their results complete, while image rows still use the batch limit.

Settings → Card printing → Printings per load accepts 1–200. Save stores the preference in local storage. The next selector uses it for the first and later batches. Invalid values do not replace a saved value; invalid or unavailable storage falls back to 25.

Validation: 114 Node tests, the Electron smoke, CSS build, and whitespace checks passed. Batch cases cover 24, 25, 26, 50, and 60 printings, later-page retry, and deferred API pages. The real Settings page saves 7, keeps it after reload, and the MTG selector then shows 7 followed by 14 rows, with no Load more link after the final batch.
