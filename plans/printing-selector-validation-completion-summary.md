# Printing selector validation completion

Completed for the side panel in `plans/printing-selector.md`.

- `tests/printingSelector.test.js`: Six Node tests cover all result pages, exact same-set variants, duplicate IDs, malformed pages, repeated pagination, unsafe endpoints, cancellation, two-face image sources, and treatment labels.
- `tests/printing-selector-smoke.cjs`: Real Electron tests with local image and API fixtures cover visible option previews, tentative choice, exact Apply, Cancel, native radio arrow keys, Escape, focus return, search and sort, two-face preview, image failure, load failure and retry, Apply callback failure recovery, empty results, unavailable printable images, stale responses, and the 375px layout.
- The smoke also uses the active `GUI/CardList/decklist.html?game=mtg` route. It checks that printings load only on request, Apply preserves three copies in one deck entry, the exact collector number reaches the saved draft, and manual deck edits close the panel. Desktop checks confirm the current deck card remains outside the drawer and the editor returns after Apply.
- `designs/printing-selector-concepts/implemented-side-panel.png` shows the active MTG page with a tentative borderless printing. API and image data in the screenshot are local test fixtures.

Validation passed: six Node tests and the Electron smoke. Run with Node 20 or later:

```sh
node --test tests/printingSelector.test.js
GUI/node_modules/.bin/electron tests/printing-selector-smoke.cjs
```
