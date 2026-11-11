# GUI and CLI feature parity plans

## Goal

Add the CLI features that have no complete GUI route. Keep the current CLI commands working. PDF creation already exposes the current creation options and needs no separate parity project.

## Plans

| Plan | Scope | Start condition |
|---|---|---|
| [01 — Game plugins](01-game-plugins.md) | Shared import service and the 20 other plugin groups | First card-workflow project |
| [02 — MTG imports](02-mtg-imports.md) | All CLI formats, files, URLs, and custom images | Plan 01 service contract and shared files are merged |
| [03 — MTG preferences and tokens](03-mtg-preferences-tokens.md) | Bulk printing rules and related tokens | Plan 02 is merged |
| [04 — Cutting templates](04-cutting-templates.md) | DXF generation, custom layouts, batch generation | Can start independently |
| [05 — Studio conversion](05-studio-conversion.md) | Windows Studio automation and conversion | Plan 04 Tools page and IPC registration are merged |
| [06 — Printer calibration](06-printer-calibration.md) | Rotation, full offset controls, sheet generation | Can start independently |
| [07 — Text translation](07-text-translation.md) | File input/output, configured paper sizes, quality zero | After Plan 04 and 06 shared worker changes are merged |

## Coordination

Run Plans 01, 04, and 06 in parallel if agents are available. Assign one integration agent to shared files: [GUI/Utilities/ipcHandlers.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/ipcHandlers.js), [GUI/shared/constants.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/constants.js), [GUI/main.js](/Users/braeburn/repos/silhouette-card-maker/GUI/main.js), [pdf_worker.py](/Users/braeburn/repos/silhouette-card-maker/pdf_worker.py), both entrypoint build scripts, [package.json](/Users/braeburn/repos/silhouette-card-maker/package.json), [GUI/package.json](/Users/braeburn/repos/silhouette-card-maker/GUI/package.json), and [GUI/README.md](/Users/braeburn/repos/silhouette-card-maker/GUI/README.md). Feature agents supply required changes as handoff notes. The integration agent applies them in order.

Within each plan, merge the service contract before starting dependent UI integration. Backend and UI work can then proceed against fixtures. Test agents own new tests; the integration agent owns changes to existing shared suites and runner lists. Never assign the same file to two active agents.

## Current limits that affect design

- The MTG GUI uses a JavaScript Scryfall adapter. The card worker currently serves Pokémon only.
- Many plugin fetch functions write to repository folders and report errors with print statements. GUI imports need isolated output and structured errors.
- The PDF worker is serial. Keep it serial.
- Studio conversion is Windows only and exits on other platforms at import time. Do not import it into a cross-platform worker.
- Calibration generation runs at import time. Refactor it before worker use.
- Custom layouts already have an extra-layout mechanism through `SCM_EXTRA_LAYOUTS`. Use it for app-owned definitions.
- Existing plans describe earlier implementations. These plans cover the remaining gaps and take precedence for this work.

## Completion

Each feature must work in a packaged app without a local Python install. Preserve existing MTG/Pokémon drafts, printing selection, image export, PDF creation, and update shutdown behavior. Do not treat a successful build as proof that Studio automation or external services work.

## Execution rules

- This is an implementation plan. No feature code has been changed.
- Each subagent owns only the files assigned to it. Agents share the codebase. Do not revert another agent's edits. The integration agent resolves shared-file changes after each handoff.
- Reuse `GUI/shared/` controls and `GUI/styles/tailwind.css`. Use `paper-button` for HTML and `createButton` from `GUI/shared/button.js` for JavaScript. Keep button states in the shared component.
- Use argument arrays and `shell: false` for processes. Keep logs separate from worker JSON. Keep jobs inside the existing job-activity gate so updates cannot restart the app during work.
- Use temporary folders and stub network services for automated tests. Add new test files to the applicable test runner. Run live service checks separately.
- Finish with a review of the full diff and the acceptance checks below.
