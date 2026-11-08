# Printing selector component completion

Completed the standalone side panel in `GUI/MagicTheGathering/printingSelector.js` and `printingSelector.css`.

- Each exact printing has a full card image, set details, treatment, and native radio input. One checkmark and an outline show the choice.
- Search, sort, larger preview, front/back controls, loading errors, image errors, and retry controls are present.
- All result pages load on open. Requests stop on close and have a 20-second limit per page. Repeated page URLs fail with retry.
- The native dialog handles Escape and focus return. Apply requires a printable PNG URL. It calls the deck callback before closing, catches callback failures in the open panel, and focuses the replacement deck control after success.
- Shared buttons keep the existing appearance. Metadata uses text nodes. Only approved Scryfall HTTPS addresses are accepted.

Checks: Node syntax check passed. Node 20 helper checks passed for pagination, same-set variants, treatment, image URLs, and invalid API URLs. The separate validation agent owns full UI and unit tests.
