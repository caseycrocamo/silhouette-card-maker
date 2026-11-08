# Printing selector side panel

Implement `designs/printing-selector-concepts/02-printing-drawer-v2.png`. Use the side panel, as requested. Keep the deck visible on wide screens. Use a full-width panel on small screens.

## Scope

- Replace the set dropdown with a visible Change printing button.
- Show each distinct printing, including collector numbers from the same set, with its own card image, set name, set code, collector number, and treatment.
- Load all result pages on demand. Show loading, retry, empty, and image failure states. Support cards with two faces.
- Search by set name, code, or collector number. Sort newest first or by set name.
- Start with 25 printings and show a Load more hyperlink for each next batch. Hide the link when all printings are shown. Settings → Card printing → Printings per load stores a whole number from 1 to 200, with 25 as the default. Use the saved size for the first and later batches.
- Show one checkmark and an outline for the tentative choice. Do not show a Selected badge.
- Keep a larger candidate preview with Front and Back controls when needed.
- Use this printing changes only the original card entry. Preserve quantity, deck order, export data, and session state. Cancel, Close, and Escape discard the tentative choice.
- Use shared paper-button controls. Use a native dialog with keyboard focus handling and focus return. Render remote metadata as text.
- Prevent stale loads and actions from changing a replaced deck entry. Load printing choices only when opened.

## Ownership

1. Component agent: `GUI/MagicTheGathering/printingSelector.js` and `printingSelector.css`. Export `openPrintingSelector({card, onApply, trigger})` and `closePrintingSelector()`. `card` is the current Scryfall object. `onApply(printing)` receives the full exact selected object only after confirmation. Return a close function. CommonJS module. No deck state changes inside the component.
2. Integration agent: the active `GUI/CardList/` page, MTG adapter, printing hooks in `GUI/shared/cardList/`, and `tests/decklistPrinting.test.js`. Connect the component and preserve export and quantity behavior. The older MTG page now redirects to the shared page due to concurrent Pokémon work. Preserve that redirect and the Pokémon flow.
3. Validation agent: `tests/printing-selector-smoke.cjs` and `tests/printingSelector.test.js`. Test the real component in Electron with local fixtures and no network. Coordinate stable selectors with the component agent.

The lead reviews integration, runs Node tests, builds CSS, runs the Electron smoke, checks screenshots, and writes completion records. All agents use the shared working tree and preserve existing edits. No unrelated worktree is merged.

## Checks

Test same-set variants, all result pages, cancellation, exact printing commit, quantity preservation, stale requests, search, two-face preview, loading failures and retry, image fallback, focus return, and narrow layout. Verify previews without hover and one checkmark without a Selected label.
