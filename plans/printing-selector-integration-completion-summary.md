# Printing selector integration completion

Completed the side-panel integration in the active shared Card List flow. Concurrent Pokémon work moved the MTG page to `GUI/CardList/decklist.html?game=mtg`; the old page remains a redirect.

- The MTG adapter keeps the full Scryfall object with each normalized printing.
- MTG cards use a shared Change printing button. Printing lists load only when the side panel opens.
- Apply commits the exact selected object. It keeps entry order and quantity, serializes the exact set and collector number, and saves through the shared session store.
- Apply rejects removed entries, replaced printings, and a list that is not ready.
- The current row is rendered again after Apply. New flip controls use the new card faces. Focus returns to the new Change printing button.
- Manual edits, search, exports, and navigation close the panel.
- The Pokémon printing select keeps its existing flow.
- On desktop, the open panel hides the deck editor and places the card results in the exposed left area. The native dialog keeps that area inert. Closing restores the full layout. Small screens keep the full panel overlay.

Validation: nine integration tests pass with Node 20. Syntax checks pass for the shared controller, result grid, and page controller. Tests cover same-set variants, stale callbacks, quantity, saved drafts, resubmit, and exact image export including paired faces. The Electron smoke passes. The active-page screenshot shows the current card beside the open panel. The lead runs the full suite.
