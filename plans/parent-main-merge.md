# Parent main merge plan

## Scope and result

Merge Alan-Cha/silhouette-card-maker main at `0da09b729814aa5aafde024b5a6059624fa87951` into this fork at `65bd3ca`. Use a merge commit to keep both histories. A merge check with `git merge-tree --write-tree` found conflicts. The merge was completed on branch `codex/merge-parent-main`.

The shared base is `3a781d197dc90f4eb24ba065569d321ebcc0b18c` (Rename Pitch enum, August 17, 2025). This is the latest shared ancestor; it is not proof of a separate prior merge event. The parent has 506 commits beyond this base. The fork has 44. The parent diff has 551 changed files, 73,946 insertions, and 2,006 deletions, plus binary changes.

## Changes since the shared base

- PDF generation: dynamic layouts, more card sizes, legal paper, paper and card aliases, registration orientation, borderless pages, specialty layouts, crop fitting, outline display, page labels, and separate bleed controls for fronts and backs.
- Calibration: angle offsets, revised offset axes, generated registration marks, and new calibration files.
- Cutting templates: new file names, layout variants, DXF generation, Studio3 conversion tools, and extra layout files.
- Card imports: new plugins for Arkham Horror LCG, Ashes Reborn, Bushiroad, Echoes of Astra, Elestrals, Final Fantasy, KeyForge, Lord of the Rings LCG, Pokemon, Sorcery, and Star Wars Unlimited. Existing plugins gain API fixes, import formats, HTTP sessions, and image handling fixes.
- MTG: double-sided MPCFill imports, URL and Cube Cobra imports, language and set filters, Universes Beyond filters, meld and reversible card fixes, and bounded Scryfall retries.
- Maintenance: CLI version 3.0.0, updated Python dependencies, a declared Python minimum of 3.12, Python 3.15 support, PDF image tests, plugin tests, Dependabot, spell checks, and new documentation.

## Confirmed conflicts and resolution rules

| Path | Conflict | Resolution |
| --- | --- | --- |
| `.github/workflows/pages.yaml` | Content | Keep the fork documentation build that does not require Pages hosting. Add parent changes only where they fit that build. |
| `.gitignore` | Content | Combine useful ignore rules. Keep generated files out of Git without hiding source assets or test fixtures. |
| `AGENTS.md` | Add/add | Preserve current local instructions. Add useful parent project facts only after checking them against this fork. Do not restore rules removed in the current local edit. |
| `assets/layouts.json` | Content | Use the parent layout schema. Port the fork text_box dimensions and layouts into that schema or an explicitly loaded extra layout file. Check orientation, units, and template names. |
| `game/back/README.md` | Rename/delete and modify/delete | Restore the parent guide if it fits the fork back-image workflow. Confirm placeholder files are excluded from image selection. |
| `requirements.txt` | Content | Use compatible parent pins and retain CairoSVG for mana symbols. Check GUI packaging, platform constraints, and the Python version used by CI. |
| `utilities.py` | Content | Use the parent PDF and layout code as the base. Port fork Markdown rendering, mana symbols, text boxes, bundled asset paths, and environment-based data paths to the new interfaces. |

## Steps

1. Preserve local edits in `AGENTS.md` and `GUI/MagicTheGathering/decklist.js` in a named stash or external patch. Record the stash ID. Create a `codex/merge-parent-main` branch from the fork main. Use the pinned parent commit above so the merge scope stays fixed.
2. Merge with `--no-commit`. Resolve the seven paths above. Keep the fork Electron app, update service, release pipeline, and PDF worker. Inspect all automatic merges before committing.
3. Adapt the worker and GUI to parent interfaces. The parent offset callback adds a required `angle` argument; supply it in `pdf_worker.py` and test both unset and saved values. The parent replaces enum-based size selection with layout-driven choices; adapt `translated_text_boxes_to_pdf.py`, which imports `PaperSize`, and all other affected imports. Check GUI flags against the new Click options, including label, crop, and bleed values. Retain environment directory defaults in `create_pdf.py`.
4. Check bundled assets and builds. Include new Python modules and layout files in each PyInstaller entry point. Retain mana symbol assets and CairoSVG support. Check changed calibration and template paths in GUI code. Apply current back-page offset axis rules to GUI labels and saved settings; migrate settings if their meaning changes.
5. Restore the two local edits. Preserve the front-only MTG face download change. Resolve any new stash conflicts without dropping either edit. Keep these edits uncommitted unless the user includes them in the merge scope.
6. Run the checks below. Review the final diff for conflict markers, lost fork functions, changed user paths, and unexpected generated files. Commit the merge, then push the branch. Keep local edits outside the merge commit.

## Relevant files

All paths are under `/Users/braeburn/repos/silhouette-card-maker/`.

- `utilities.py`: PDF generation, layout loading, Markdown rendering, mana symbols, and saved offsets.
- `assets/layouts.json`: card sizes, page layouts, registration settings, and variants.
- `create_pdf.py` and `offset_pdf.py`: Click interfaces used by the app.
- `pdf_worker.py`: `handle_create_pdf` and `handle_offset_pdf`.
- `translated_text_boxes_to_pdf.py`: `PaperSize` import and `generate_md_pdf` call.
- `GUI/Utilities/ipcHandlers.js` and `GUI/shared/constants.js`: GUI commands, paths, and settings.
- `check_and_build_entrypoints.js`, `build_entrypoints.sh`, and `build_entrypoints.bat`: packaged worker and asset builds.
- `.github/workflows/pages.yaml`, `.github/workflows/release.yml`, and `.github/workflows/pdf-worker.yml`: documentation and release checks.

## Verification

- Run `git diff --check` and check for unmerged paths.
- Run `npm test` for the fork worker, release, update, and path tests.
- In a separate Python environment, install the merged dependencies. Run `python -m pytest test -m unit` and `python -m pytest tests/test_pdf_worker.py`. Confirm test collection succeeds before selecting narrower checks.
- Run parent PDF image tests from `test/test_create_pdf.py` with their required fixtures and tools. Compare front and back alignment, registration, bleed, borderless pages, and labels.
- Generate a translated text-box PDF with mana symbols on each supported paper size. Check text wrapping, dimensions, and template alignment.
- Exercise create and offset requests through the persistent worker. Verify saved offsets, angle defaults, front-only double-sided cards, common backs, and output directories.
- Build native entry points on each supported platform through CI. Verify bundled assets and run the packaged PDF worker smoke test. Run plugin network tests separately with the credentials and services they need.
- Confirm the merge commit contains both parent histories and the pushed branch matches its remote. Confirm local edits remain intact.

## Decisions and limits

Implementation completed after approval. Verification: 48 JavaScript tests passed with Node 22; 398 Python tests passed with 119 integration or slow tests excluded; all-paper-size text-box rendering passed; the frozen macOS worker smoke test passed. Requirements installed on Python 3.12 and 3.13. Native Windows and Linux builds still require CI. Parent files retain existing whitespace issues; edited merge-resolution files pass whitespace checks. A clean text merge would still need the interface and packaging checks above. The merge must preserve the fork app features while adopting the parent engine changes.
