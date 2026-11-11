# MTG imports completion

Implemented in source on 2026-11-11. Native package acceptance remains open.

- The game options include all ten CLI formats plus the existing GUI text syntax.
- The card worker stages MTG imports. CLI parsers supply text, URL, CSV, JSON, and XML records. Optional direct-image callbacks keep CLI download behavior unchanged and let GUI imports preserve custom-image provenance.
- The page opens deck files, keeps the original source document, and stores drafts by format. File retries reuse the selected source. Editing a loaded document uses the editor text on the next search.
- Custom images decode to PNG in the worker cache. Custom images cannot open printing selection. MPCFill preserves slot order, repeated fronts, and per-slot backs. Both export modes preserve quantities.
- Import retries cache successful source rows and retry failed rows. Controller retry keeps manual printing choices for successful rows. An import does not write PDF source folders.

Checks: new offline Python format/custom-image/retry/MPCFill tests; Node adapter/session tests; MTG import/preferences Electron smoke; existing card-list and printing-selector Electron smoke. Exact current counts are in the root report. The selector fixture logs its existing missing calibration-capability stub messages but exits successfully.

Open: frozen app checks without Python on supported platforms, optional public URL import, and packaged import-to-PDF acceptance. Live provider availability was not tested. Worker requests retain existing cancellation behavior: stale GUI results are ignored; an active Python import completes or reaches the process timeout.
