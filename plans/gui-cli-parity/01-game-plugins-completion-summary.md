# Game plugins completion record

Status: source implementation and offline acceptance checks pass. Native release
checks for remote plugin imports remain open.

- All 20 plugin groups have a Home route, format-specific options, staged imports,
  preview/export, and game/format-scoped drafts. Source and scenario choices and
  LOTR local back scans use existing plugin behavior.
- File retry keeps the selected source. Open deck file can select a replacement.
  Retry replaces the result list, so quantities do not multiply. Parsers without
  an entry-level retry API still reimport the full source.
- A callback that creates no front image now reports an import error, even when
  another card succeeds. This prevents a silent incomplete success.
- Cache images are decoded and written as PNG. Imports use temporary directories;
  PDF source folders change only through explicit export.

Checks: all 47 advertised formats have real-parser fixtures for success and fetch
failure, with network access blocked. Tests verify quantity, source preservation,
PNG normalization, and empty failed caches. Existing dispatcher and real-handler
fixtures cover front/back pairing and local scans. Node checks cover file retry,
replacement, quantity, format isolation, and game isolation. The Electron game
picker/import/retry/paired-export smoke passed against local fixtures.

Remaining: real service checks and successful frozen front-only and paired-back
imports for the other plugin groups on supported release platforms. Native MTG
custom-image checks are separate evidence, not proof of all remote providers.
