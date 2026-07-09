# Plan: Double-Sided Card Support in the GUI

## Context

The CLI (`create_pdf.py` → `utilities.py::generate_pdf`) already fully implements double-sided cards: any file in `game/double_sided/` must have a filename (incl. extension) matching a file in `game/front/`; that pair prints as a real double-sided card, while unmatched front images print with the generic back. A mismatch (a `double_sided` file with no matching front) raises a hard exception, and so does combining `--only_fronts` with any `double_sided` images present (`utilities.py:979-987`).

The CLI-adjacent deck-import plugin (`plugins/mtg/scryfall.py`) already does this correctly for Magic cards: it defines `double_sided_layouts = ['transform', 'modal_dfc']` and, only for those layouts, fetches the back face and saves it into `double_sided_dir` under the **same filename** as the front (`fetch_card_art`, `scryfall.py:22-57`).

The Electron GUI never adopted this. `GUI/CreatePDF/create.html`/`create.js` (the "Create PDF" step) has sections for front images and a single default back image, but nothing for `game/double_sided/` — no `ipcHandlers.js` handlers exist for it (the file even has a trailing comment: `// Add similar logic for output, decklist, double_sided as needed`). Meanwhile `GUI/MagicTheGathering/decklist.js` (the "Card List" step — there is no literal `cardlist.html`; this is the page that plays that role in the nav) re-implements Scryfall fetching in JS and, for **any** card with more than one `card_faces` entry, dumps **both** faces into `game/front/` as independent cards (`decklist.js:133-146`). This is wrong for two reasons: it doesn't distinguish true double-faced layouts (`transform`/`modal_dfc`) from single-sided multi-face layouts (split/adventure/flip), and even for true DFCs it never uses `game/double_sided/`, so the real back face is lost and the card prints twice with a generic back instead of once, correctly, on both sides.

Per user direction, this becomes a first-class choice presented to the user on the Card List step, not just a silent bug fix: a **Front Only** vs **Double Sided** workflow toggle, because both are legitimate physical-printing methods:
- **Front Only** — print just the fronts; best for the proxy method of applying vinyl stickers over real cards ("draft chaff").
- **Double Sided** — print true fronts and backs; best for printing on card stock and laminating.

This toggle is explicitly "the same option" as the existing `--only_fronts` checkbox on `create.html` (the CLI already errors if you mix `--only_fronts` with any `double_sided` images), so the two must be kept in sync. `create.html` also gets a full management section for `game/double_sided/` (list/upload/clear), independent of where the images came from, mirroring the existing Front/Back sections.

---

## 1. Workflow toggle on `GUI/MagicTheGathering/decklist.html` / `decklist.js`

**File:** `GUI/MagicTheGathering/decklist.html`

Add a new `paper-element` subsection directly above the "Next: Create PDF" button, containing:
- Two radio options styled like the existing checkbox labels in `create.html` (`flex items-center space-x-3 p-3 bg-surface rounded-lg ...`): **Front Only** and **Double Sided**, `name="cardWorkflow"`.
- A short blurb under the options, using the user's own framing:
  - *Front Only — Print just the card fronts. Best for the proxy method: print onto vinyl stickers and apply them over real cards (draft chaff).*
  - *Double Sided — Print true fronts and backs for double-faced cards. Best for printing directly on card stock and laminating.*

**File:** `GUI/MagicTheGathering/decklist.js`

- On `window.onload`, restore the selected radio from `sessionStorage.getItem('cardWorkflow')` (values `'front_only'` / `'double_sided'`); default to `'double_sided'` if unset (new capability, defaults to showcasing it — flag for the user to flip if they'd rather default to `front_only`).
- Add a `change` listener on the radios that persists the new value to `sessionStorage['cardWorkflow']` immediately.

## 2. Fix DFC export + apply the workflow choice in `decklist.js`

**File:** `GUI/MagicTheGathering/decklist.js`, inside the `nextCreatePdfBtn` click handler (currently lines 107-160).

- Import `getDoubleSidedDir` alongside the existing `getFrontDir` import from `../shared/constants`.
- Extract the duplicated name-sanitizing logic (currently inlined twice, at lines 138-140 and 150-152, doing the exact same thing to different name sources) into one local helper, e.g. `sanitizeCardName(name)`.
- Extend the existing "existing files" confirm-clear block (lines 117-127) to also check/clear `game/double_sided/` alongside `game/front/` in the same confirmation, so switching workflows across sessions can't leave stale, mismatched double-sided images behind.
- Replace the per-face loop (lines 133-158) with, per card:
  - `isDoubleSided = (workflow === 'double_sided') && ['transform', 'modal_dfc'].includes(data.layout) && data.card_faces?.[0]?.image_uris?.png && data.card_faces?.[1]?.image_uris?.png` — reusing the exact `['transform', 'modal_dfc']` list from `plugins/mtg/scryfall.py:7` as the source of truth for which layouts are physically double-sided.
  - Compute `name = sanitizeCardName(data.name)` once (top-level card name, not a per-face name — this is what makes the two filenames match, mirroring `scryfall.py`'s use of the outer `card_json['name']` for both sides).
  - If `isDoubleSided`: write `card_faces[0].image_uris.png` to `front/${imgCount}${name}1.png`. Only if that write succeeds, write `card_faces[1].image_uris.png` to `double_sided/${imgCount}${name}1.png` (identical filename). If the back write fails/is skipped, the card simply falls back to single-sided — never write an orphaned double-sided file.
  - Else (front-only mode, or a card that isn't a true DFC — normal/split/adventure/flip): write one image to `front/${imgCount}${name}1.png` using the existing fallback `data.image_uris?.png ?? data.card_faces?.[0]?.image_uris?.png` (this is exactly today's existing else-branch, now also covering the split/adventure/flip cases that were previously mis-handled as dual-front).
  - Increment `imgCount` once per card regardless of branch (today it double-increments for multi-face cards — part of the same bug).
- After the export loop, persist the derived flag for `create.html`: `sessionStorage.setItem('onlyFronts', String(workflow === 'front_only'))`.

## 3. Sync into `create.html`'s Only Fronts checkbox

**File:** `GUI/CreatePDF/create.js`

- On `DOMContentLoaded`, if `sessionStorage.getItem('onlyFronts')` is set, apply it to `onlyFrontsCheckbox.checked` and dispatch a `change` event so the existing arg-string logic (`create.js:164-178`) runs unchanged. The checkbox remains fully user-editable afterward — this is a one-time default sync when arriving from the Card List step, not a locked/derived field, so it still works fine if the user opens `create.html` directly.

## 4. New IPC handlers in `GUI/Utilities/ipcHandlers.js`

Mirroring the existing `get-front-images`/`clear-front-images`/`select-back-image` handlers:

- **`get-double-sided-images`** — list files in `getDoubleSidedDir()` matching `/\.(png|jpe?g)$/i` (same pattern as `get-back-images`).
- **`clear-double-sided-images`** — delete all image files in `getDoubleSidedDir()` (mirrors `clear-front-images`).
- **`upload-double-sided-images`** — `dialog.showOpenDialog` with `properties: ['openFile', 'multiSelections']`, filter png/jpg/jpeg; copy each selected file into `getDoubleSidedDir()` **preserving its original filename** (no renaming — per the confirmed "simple pass-through" scope, the user is responsible for naming files to match a front filename, exactly as documented). Overwrite silently on name collision, consistent with there being no existing collision handling elsewhere in this file.
- Add `startDoubleSidedDirWatcher()`, a small parallel of the existing `startFrontDirWatcher()` (lines 28-40), emitting `double-sided-images-changed` on change, and call it alongside `startFrontDirWatcher()`.

## 5. New "Double-Sided Images" section in `create.html` / `create.js`

**File:** `GUI/CreatePDF/create.html`

Add a new section between the existing Front Files section and Back Image section (grouping the two front-paired concepts together), structurally mirroring the Front Files Section:
- Header "game/double_sided folder images" + "Upload Double-Sided Image(s)" and "Clear Double-Sided Images" buttons.
- Grid container `doubleSidedImagesGrid`.
- A hidden-by-default inline warning banner (e.g. `#onlyFrontsConflictWarning`) for the only-fronts/double-sided conflict.

**File:** `GUI/CreatePDF/create.js`

- Import `getDoubleSidedDir`.
- Cache the loaded front filenames (module-level array) when `loadImages()` runs, so cross-validation can check membership.
- Add `loadDoubleSidedImages()`, mirroring `loadImages()`: fetch via `get-double-sided-images`, render thumbnails with `attachHoverPreview` (reuse existing helper), and add a warning badge/outline on any thumbnail whose filename isn't in the cached front filename set (client-side reflection of the CLI's subset check in `utilities.py:982-983`).
- Wire `uploadDoubleSidedBtn` → `upload-double-sided-images` → reload grid; `clearDoubleSidedBtn` → `clear-double-sided-images` → reload grid.
- Listen for `double-sided-images-changed` and refresh, mirroring the existing `front-images-changed` listener.
- Show/hide the conflict warning banner whenever `onlyFrontsCheckbox.checked && doubleSidedFilenames.length > 0` (recompute on checkbox change and on grid reloads) — a friendly, non-blocking reflection of the CLI's hard error in `utilities.py:985-987`, without adding new client-side blocking validation.

---

## Files Changed

| File | Change |
|------|--------|
| `GUI/MagicTheGathering/decklist.html` | Add Front Only / Double Sided toggle + explanatory blurb above "Next: Create PDF" |
| `GUI/MagicTheGathering/decklist.js` | Persist/restore workflow choice; fix DFC export to use `game/double_sided/` correctly; dedupe name-sanitizing; sync `onlyFronts` for create.html |
| `GUI/CreatePDF/create.html` | New "Double-Sided Images" section (grid, upload/clear buttons) + conflict warning banner |
| `GUI/CreatePDF/create.js` | Load/render/upload/clear double-sided images; cross-validate against front images; sync `onlyFronts` checkbox on load |
| `GUI/Utilities/ipcHandlers.js` | New handlers: `get-double-sided-images`, `clear-double-sided-images`, `upload-double-sided-images`; new dir watcher |

No changes needed to `GUI/shared/constants.js` (`getDoubleSidedDir` already exists and is already wired into `run-create-pdf`'s env vars) or to the Python side (`create_pdf.py`/`utilities.py` already fully support this).

## Verification

This is an Electron desktop app, not a browser page, so it's verified by running the app directly rather than a browser preview tool:

1. `cd GUI && npm run start`.
2. On the Card List step, search a known modal-DFC card (e.g. `Valki, God of Lies // Tibalt, Cosmic Impostor`) or transform card (e.g. `Delver of Secrets // Insectile Aberration`).
3. **Front Only path:** select "Front Only", click "Next: Create PDF" → confirm exactly one image was written to `game/front/` (not two) and `game/double_sided/` stays empty; confirm "Only Fronts" arrives pre-checked on `create.html`; click "Create PDF" and confirm it succeeds.
4. **Double Sided path:** re-search the same card, select "Double Sided", click "Next: Create PDF" → confirm `game/front/` and `game/double_sided/` each get a file with the *identical* filename; confirm "Only Fronts" arrives unchecked; confirm the new Double-Sided Images section on `create.html` shows the thumbnail with no orphan warning; click "Create PDF" and open the resulting PDF to confirm the card's real back face appears (not the generic back).
5. Use "Upload Double-Sided Image(s)" to add a file with a name that doesn't match any front image; confirm the orphan warning badge appears, and confirm checking "Only Fronts" while it's present shows the conflict banner.
6. Round-trip "Clear Double-Sided Images" and confirm the grid empties and re-populates correctly if a file is dropped into the folder externally (watcher).
