# Silhouette Card Maker 1.3.0

November 11, 2026

## New features

- Import deck lists from 20 additional game plugin groups. These include Yu-Gi-Oh!, Lorcana, One Piece, Netrunner, Riftbound, and the Arkham Horror and Lord of the Rings LCGs. Available formats, image sources, and scenario choices depend on the game.
- Create DXF cutting templates in Tools. Use named or custom card and paper sizes, corner radii, page orientation, and standard or borderless layouts. Generate missing templates, regenerate all templates, or optimize layouts in a batch with progress and cancellation between files.
- Save custom sizes and optimized layouts in app data. Use the same geometry in PDF creation without changing bundled layout files or restarting the app.
- Set printer rotation, per-run X/Y offsets, PPI, and an output PDF path. Per-run changes leave saved calibration values unchanged.
- Generate calibration sheets for selected paper sizes or all configured sizes, including custom paper sizes.

## Interface changes

- Choose every game from one consistent picker, including Magic: The Gathering and Pokémon.
- Choose the MTG task, deck format, image source, scenario, and print setup in a shared options popup. Use Options on the card-list page to change these choices.
- Open game options from bundled metadata without waiting for Python startup. A local Electron check opened the popup in 11 ms without the card worker.
- Keep the card-list page focused on the deck and card previews.
- Remove filename labels below front, double-sided, and generic-back previews on the Create PDF page.

## Fixes

- Preserve card quantities, source order, paired faces, and separate drafts for each game and format.
- Keep successful cards when part of an import fails. Show errors and warnings, and allow the import to be retried.
- Keep different images and backs for cards that share a name. Pair fronts and backs even when their file extensions differ.
- Match local Lord of the Rings back scans by card name or code.
- Keep current choices when the options popup is canceled. Keep existing card previews when only the print setup changes.
- Include all game plugin modules in packaged workers and use UTF-8 for worker requests on Windows.
- Keep template batches inside the update job lock so an update cannot interrupt a batch between files.
- Store default offset output in a writable folder and preserve drafts saved by earlier versions.

## Validation

Local checks cover JavaScript behavior, Python catalog and worker parity, game imports with fixtures, options, printing selection, PDF settings, calibration sheet rendering, and the custom-template-to-PDF workflow. Native macOS arm64 workers and the app bundle were built and opened.

Windows/Linux release packaging, live card-provider checks, physical print alignment, and packaged upgrade checks remain separate release checks. These notes describe the source release; installers are built separately.
