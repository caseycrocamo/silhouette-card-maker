# PDF creation settings

## TL;DR

Replace the three flag checkboxes and the command text field on Create PDF with a **PDF settings** preferences modal. Give each PDF creation option a named control. Organize controls into three sidebar categories: **Page layout**, **Image settings**, and **File settings**. Select Page layout by default. Use one settings object to build an argument array for the existing Python worker.

The Python CLI already accepts all 28 creation options. The remaining work is mainly GUI coverage, state management, validation, and output handling. This plan includes small backend corrections needed for reliable GUI use. It does not add a second PDF engine.

## Current state

- `GUI/CreatePDF/create.html` exposes Only Fronts, Skip 4, Load Offset, and a free text argument field. All other options require command syntax.
- `GUI/CreatePDF/create.js` edits that text with string searches. A typed flag can disagree with a checkbox. The page restores `sessionStorage.onlyFronts` from the Card List workflow, but does not save changes made on this page.
- `GUI/Utilities/ipcHandlers.js` splits the argument string with a regular expression. It retains quote characters and cannot reliably carry labels and paths with spaces.
- `pdf_worker.py::handle_create_pdf` uses Click to parse an argument array. Keep this path as the authority for option syntax and defaults.
- `utilities.py::generate_pdf` implements PDF and PNG output. The page only recognizes `Generated PDF:`. PNG output can therefore open an old PDF through the viewer's default path.
- The front-only conflict warning sits inside the double-sided section. That section is hidden when front-only is selected, so the warning can be hidden when it is needed.
- Layout choices and aliases come from `assets/layouts.json` and optional extra layout files. Do not copy these choices into HTML.

## Settings coverage

Every creation option must have a control or an explicit file-management action. CLI help and version switches are not creation settings.

| Group | CLI options | Controls and behavior |
| --- | --- | --- |
| Page layout | `card_size`, `paper_size` | Select lists from the worker; defaults Standard and Letter. Show dimensions with names. |
| Page layout | `registration`, `registration_orientation` | Three or four marks; orientation Auto, Portrait, or Landscape. Auto omits the orientation override. Explain that this changes marks, not card layout. |
| Page layout | `specialty`, `borderless` | Optional specialty preset and tighter margins toggle. Disable borderless for a specialty preset. Show the effective preset geometry. |
| Page layout | `only_fronts` | Fronts only / Fronts and backs. Keep this synchronized with the Card List workflow. |
| Page layout | `skip` | List of zero-based page positions, with an optional Skip position 4 shortcut. Emit one `--skip` pair per unique position. Explain that these are sheet slots, not source card numbers. |
| Page layout | `load_offset` | Apply saved printer offset. Show whether saved data exists and link to calibration on Settings. |
| Image settings | `fit`, `fit_backs` | Front and paired reverse fit: Stretch or Crop. Generic back fit: Same as fronts, Stretch, or Crop. Default Stretch; Same as fronts omits `fit_backs`. |
| Image settings | `crop`, `crop_backs` | Separate crop fields for fronts/paired reverses and generic backs. Blank disables. Use explicit mm, in, or percent units; bare crop values mean percent, not pixels. |
| Image settings | `extend_edges`, `extend_edges_backs` | Separate edge extension fields for fronts/paired reverses and generic backs; mm, in, or layout pixels. |
| Image settings | `extend_corners`, `extend_corners_backs` | Separate corner extension fields for fronts/paired reverses and generic backs; mm, in, or layout pixels. |
| Image settings | `extend_bleed`, `extend_bleed_backs` | Separate front-page and back-page outer bleed fields. Back-page bleed also affects paired reverse cards. Use mm, in, or layout pixels. |
| Page layout | `label`, `show_outline` | Optional page label and white cutting-path outline. Preserve label spaces, quotes, and Unicode. |
| File settings | `ppi`, `quality` | Integer PPI of at least 1, default 300; compression quality 0–100, default 100. Explain that quality applies to PDF compression; do not promise PNG file-size control. |
| File settings | `output_images`, `output_path` | PDF / PNG pages selector; Save PDF dialog or output folder picker. Default PDF path remains the app output directory plus `game.pdf`. |
| File settings | `front_dir_path`, `back_dir_path`, `double_sided_dir_path` | Advanced folder selectors, defaulting to the app's managed folders. Changing a source must also change the relevant image list, file actions, and validation. |

## Phase 1 — Define the settings contract

1. Add a read-only worker command for PDF capabilities. Derive option defaults, choices, ranges, and repeatability from `create_pdf.cli.params`. Add layout dimensions, aliases, available variants, and specialty geometry from `load_layout_config()`. Add a contract version. No PDF is generated by this command.
2. Expose the command through `pdfWorkerClient.js` and a main-process IPC handler. Use the same worker queue and error handling as creation. Do not read a second copy of the layout configuration in the renderer.
3. Add a pure `GUI/shared/pdfCreationSettings.js` module. It supplies normalized defaults, validates settings, and converts settings to an argv array. Use stable keys and an explicit allowlist. Preserve the difference between absent optional values and zero. Emit booleans once and repeat `--skip` as needed.
4. Resolve supported layout combinations from actual configured layouts. Disable unavailable paper/card/variant combinations. Do not assume every listed card size works on every paper size.
5. Correct the specialty help text: it claims to override registration, but `generate_pdf` still passes the selected mark count to page generation. Preserve that behavior, keep mark count editable, and explain that specialty controls geometry. Keep registration orientation editable as an explicit override.

Dependencies: complete this contract before binding the panel. Metadata and the pure JS module can be developed separately once the response shape is fixed.

## Phase 2 — Build the panel on Create PDF

1. Replace the current options section with a PDF settings button that opens the approved preferences modal. Add category navigation, search, Save/Cancel actions, and a page preview from backend layout geometry. Use exactly three sidebar categories, in this order: **Page layout**, **Image settings**, and **File settings**. Select Page layout by default, with page mode, paper size, and card size first. Place registration, specialty, borderless, skipped positions, saved offset, page label, and cutting outline in Page layout. Place fit, crop, edge extension, corner extension, and page bleed in Image settings. Place output format, destination, PPI, compression quality, and source folder selectors in File settings. Use fieldsets within each category where needed; do not add more top-level categories. Keep Create PDF below the panel; change its label to Create images for PNG output.
2. Reuse the existing `paper-element`, `paper-input`, and `paper-button` styles. Use a single column on narrow windows and two columns where space permits. Keep labels, units, descriptions, and error text associated with each input. Use native buttons, fieldsets, selects, and expandable sections for keyboard access.
3. Remove the editable raw argument field and string-editing checkbox listeners. All existing flags become settings controls. No duplicate manual flag path remains. Keep the CLI available for direct command use.
4. Bind every control to the settings object. Restore settings when the user returns from the viewer. Store a versioned draft in session storage; do not add a disk preference system for this work. Provide Reset PDF settings, which restores CLI defaults and the managed source folders.
5. Preserve the existing Card List handoff. Import its `onlyFronts` value when it changes. Changes on Create PDF must update `onlyFronts` and `cardWorkflow`, so returning to Card List does not restore stale state. Reset must update these keys too. Do not delete or re-export images when a setting changes.
6. Hide back-only controls when printing fronts only, but retain their values for later. Keep source conflicts visible above the action button, outside any hidden section. Provide a direct action to show the double-sided source controls so the user can resolve a conflict.
7. When specialty is active, disable ordinary geometry controls and borderless, retaining their draft values. Omit inactive values from argv. Returning to the standard layout restores those draft values.

Dependencies: Phase 1. Do not change the separate global Settings screen except for a calibration link target if needed.

## Phase 3 — Connect sources, validation, and creation

1. Change `run-create-pdf` to accept the validated argv array. Remove the quote-splitting expression. Validate the request in the main process before passing it to `runCreatePdf`; never build a shell command. Update all callers and tests together.
2. Add native folder and save dialogs for source and output selection. Cancellation leaves the current value unchanged. Refactor image list, upload, clear, and watcher handlers so they use the selected source folders, rather than silently operating on the managed defaults. Confirm destructive clear actions against the folder that is actually selected.
3. Validate required paths, numeric ranges, units, supported layouts, specialty/borderless conflicts, and skip positions. Keep Python validation authoritative. Show field errors beside controls and a useful summary near Create. On validation failure, open the relevant group and focus the first invalid field.
4. Use one backend layout resolver for creation and preflight if exact sheet capacity is needed. Return row count, column count, and slot count; do not reproduce placement geometry in JS. Keep validation read-only: do not call `generate_pdf` to inspect inputs, since it removes hidden source files.
5. Reject unmatched double-sided filenames and fronts-only/double-sided conflicts before submission. Recheck in Python at execution time because source files can change after preflight. Allow generation without a generic back, which the backend already supports.
6. Normalize duplicate skip indices in Python as well as JS before checking capacity. The current backend uses list length to calculate capacity, so duplicate indices can give a wrong result. Preserve the CLI's warning for out-of-range slots, display that warning in the GUI, and block skipping every valid slot.
7. Validate crop bounds against card dimensions and reject settings that remove the full image. Preserve the different meanings of bare crop values and bare extension values. Use the existing Python parsers for final interpretation.
8. Make missing saved offset data visible. Allow generation without the offset after a clear warning, matching the current backend behavior. Keep generation logs available so warnings are not lost on navigation.
9. Disable repeated submission while a job is active. Reuse the loading overlay and `jobActivity`. Restore controls after failure and keep all values. Worker metadata or preflight failures must show an error with Retry, not an empty panel with guessed choices.

Dependencies: Phases 1 and 2. Source folder support is required before exposing editable source path controls.

## Phase 4 — Complete output handling

1. Add structured output data to successful creation responses: output kind, actual destination, generated file paths, and log. Derive this data from the resolved generation result; stop using the log as the GUI routing contract. Keep CLI success messages for command users and keep offset responses compatible.
2. Return the structured result through IPC. Open the PDF viewer with the exact PDF path. For PNG output, stay on Create PDF and show the destination, generated page count, and an Open folder action. Never open the default or previous PDF after image generation.
3. Fix output directory preparation for PNG generation. `get_directory()` treats a nonexistent directory as a file path and selects its parent. Create and use the requested image directory explicitly. Preserve existing CLI behavior for callers that supply a PDF-like path with `--output_images`; add tests for both forms before changing the helper contract.
4. Handle file overwrite with a native save dialog for PDFs. For PNG output, detect existing `pageN.png` files and ask before replacing them. Report only files produced by this run; do not count or delete unrelated files or stale pages from older runs.
5. Show output errors on the creation screen, including invalid destinations and permission failures. Keep the selected settings available for retry.

Dependencies: Phase 3 transport. Structured results require coordinated Python, worker-client, IPC, and renderer updates.

## Phase 5 — Verify and document

1. Add Node tests for settings defaults, every option's argv mapping, omitted optional values, zero values, repeated skips, Unicode labels, and paths with spaces and quotes. Add a coverage assertion that every Click creation option is represented by the GUI contract.
2. Add renderer tests using the existing Node test and VM style: panel state, reset, workflow synchronization, specialty transitions, back-control visibility, visible conflicts, validation focus, retry, and PDF versus PNG completion. Register new test files in the root `npm test` script.
3. Add IPC tests for array transport, malformed requests, canceled dialogs, selected source folder operations, and structured output. Verify quoted values arrive as one argument without added quote characters.
4. Extend Python tests for metadata parity, duplicate/all/out-of-range skip cases, missing offset warnings, crop bounds, specialty conflicts, custom source paths, and new PNG destinations. Extend frozen-worker smoke coverage for metadata, custom PDF paths, PNG completion, and reuse after a failed request.
5. Reuse `test/pdf_cases.py` and existing image comparisons. Add missing cases for generic-back fit, crop, edge extension, and corner extension; include paired reverse images and specialty layouts. Confirm output page count, dimensions, and image changes, not just success status. Do not replace reference images merely to make a test pass.
6. Run `npm test`, `python3 -m pytest test/test_utilities.py test/test_create_pdf.py`, and `npm run build:css`. Rebuild Python entrypoints with `npm run build:entrypoints` and copy them with `npm run copy:entrypoints`; then run `python3 -m unittest discover -s tests`. Check source and packaged app behavior, since an old frozen worker will not support the new commands. Use a focused test subset first if image baselines are unavailable; report missing fixtures as a test limit.
7. In Electron, check keyboard access, narrow-window layout, return from viewer, Card List round trips, all control groups, reset, specialty toggling, source folder changes, labels and paths with spaces/Unicode, invalid inputs, missing offset, overwrite cancellation, and both output formats. Confirm folder actions affect the selected folder and no PNG run opens an old PDF.
8. Update the Create PDF section of `GUI/README.md` and `hugo/content/tutorial/guide.md`, including screenshots, units, defaults, and PNG output. Clarify that changing print mode does not rebuild previously exported card images.

## Relevant files

All paths below are under `/Users/braeburn/repos/silhouette-card-maker/`.

| File | Work |
| --- | --- |
| `GUI/CreatePDF/create.html` | Settings panel, grouped controls, validation and completion regions. |
| `GUI/CreatePDF/create.js` | Replace flag-string state; connect controls, source lists, workflow, and output routing. |
| `GUI/shared/pdfCreationSettings.js` (new) | Pure settings normalization, validation, and argv builder. |
| `GUI/Utilities/ipcHandlers.js` | Metadata, dialogs, source operations, argv transport, result forwarding. |
| `GUI/Utilities/pdfWorkerClient.js` | Metadata/preflight request helpers; preserve worker queue and shutdown behavior. |
| `pdf_worker.py` | Metadata/preflight dispatch and structured creation result. |
| `create_pdf.py` | Keep Click option definitions authoritative; correct specialty help. |
| `utilities.py` | Shared layout resolution, skip normalization, crop validation, output paths and result data. |
| `assets/layouts.json`, `enums.py` | Existing geometry and choice sources; no duplicate hard-coded GUI lists. |
| `GUI/shared/constants.js` | Managed folder defaults for reset and initial state. |
| `GUI/MagicTheGathering/decklist.js` | Existing workflow storage handoff; preserve current export behavior. |
| `GUI/Utilities/pdf_viewer.js` | Verify exact destination handling; change only if needed. |
| `GUI/styles/tailwind.css` | Add only panel styles missing from the current design system; rebuild generated CSS. |
| `tests/decklistPrinting.test.js`, `tests/test_pdf_worker.py` | Extend workflow and packaged worker coverage. |
| `test/test_utilities.py`, `test/test_create_pdf.py`, `test/pdf_cases.py` | Backend validation and output regressions. |
| `package.json`, `GUI/README.md`, `hugo/content/tutorial/guide.md` | Test registration and user instructions. |

## Decisions and scope

- “Remaining functionality” means all 28 current PDF creation options are usable through the GUI, including source paths and image output. It does not mean adding new CLI flags or changing card export rules.
- Use the approved preferences modal with a category sidebar and a persistent page preview. Keep PDF creation on the main screen. Save applies the draft; Cancel, Close, and Escape discard it.
- Keep CLI defaults and generation behavior unless a listed defect prevents reliable use. Keep existing command invocations working.
- Persist drafts for the current app session. Durable presets and named profiles are separate work.
- No preview engine, live rendering, new layout editor, or changes to PDF worker concurrency are needed.
- Preserve current unrelated edits. At research time, the working tree has changes in `AGENTS.md`, `GUI/MagicTheGathering/decklist.js`, and `create_pdf`, plus untracked executable tools. Review these before implementation and do not overwrite them.

## Completion criteria

- Every creation option has a usable GUI control or source/output action under Page layout, Image settings, or File settings; no command syntax is required.
- Existing Only Fronts, Skip 4, and Load Offset behavior is retained through the settings panel.
- GUI state, source thumbnails, submitted arguments, and generated output agree.
- Invalid combinations produce visible errors; supported defaults produce the same PDF as the current CLI.
- PDF and PNG creation both lead to the correct result, including custom and Unicode paths.
- Required tests pass, the packaged worker supports the new contract, and the guide matches the final screen.
