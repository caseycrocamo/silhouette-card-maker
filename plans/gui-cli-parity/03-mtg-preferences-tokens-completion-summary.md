# MTG preferences and tokens completion

Implemented in source on 2026-11-11. Native package acceptance remains open.

- Added every MTG CLI preference, ordered set/language lists, validation, reset, and option help. CLI and GUI share option validation. Contradictory Universes Beyond choices are rejected.
- Preferences are saved with the MTG format session. Applying preferences marks results stale and keeps current printing previews visible until an explicit search. Search identity includes source, format, and validated options.
- The GUI runs the existing CLI Scryfall selection code through an optional art callback. No separate ranking algorithm was added. Supplied set/collector data and ignore-printing precedence remain intact. Custom imports bypass preference processing.
- Related tokens appear as separate rows with parent identity. Repeated token identities are combined, and quantities sum the parent quantities. Retry replaces result rows and uses successful cached rows, so output does not multiply.
- Imported Scryfall rows retain manual printing selection; custom rows show why selection is unavailable. Manual choices on successful rows survive retries.

Checks: option validation/ordering/forwarding tests, actual CLI selector exact-printing precedence test, token quantity/deduplication and retry tests, stale/manual-choice Node tests, new MTG import/preferences smoke, existing card-list and printing-selector smoke, and the existing MTG Python suite.

Open: frozen app verification and live-service checks. Token image errors currently fail the source row and are retried with that row; the GUI does not provide a separate token-only retry control.
