# Plan: Offset Calibration GUI Support

## Overview

Add GUI support for printer offset calibration: edit `offset_data.json`, run `offset_pdf.py`, and apply saved offsets when creating PDFs.

---

## 1. `--load_offset` Checkbox in `create.html`

**File:** `GUI/CreatePDF/create.html`  
Add a third checkbox below the existing Skip 4 checkbox:

```html
<label class="flex items-center space-x-3 ...">
    <input type="checkbox" id="loadOffsetCheckbox" class="...">
    <span ...>Load Offset (--load_offset)</span>
</label>
```

**File:** `GUI/CreatePDF/create.js`  
Follow the existing checkbox pattern — listen for `change`, append/remove `--load_offset` from the `pdfArgs` input value.

---

## 2. New IPC Handlers in `ipcHandlers.js`

**File:** `GUI/Utilities/ipcHandlers.js`

Add a `getDataDir()` helper in `constants.js` pointing to `../../data` (dev) with `getUserDataDir('data')` fallback for packaged mode. Export it.

Add three new handlers:

### `read-offset-data`
Read `offset_data.json` → return `{ x_offset, y_offset }`. Return `{ x_offset: 0, y_offset: 0 }` if file missing.

### `save-offset-data`
Accept `{ x_offset, y_offset }` → write to `offset_data.json`. Create the `data/` directory if it doesn't exist.

### `run-offset-pdf`
Accept `{ pdfPath, xOffset, yOffset, save }` → spawn the `offset_pdf` binary (same pattern as `run-create-pdf`). Build args array:
- `--pdf_path <pdfPath>` (if provided)
- `-x <xOffset>` `-y <yOffset>` (if provided)
- `-s` (if `save` is true)

---

## 3. Offset Calibration Section on `home.html`

**File:** `GUI/Home/home.html`  
Add a new `paper-element` section after the header. Two subsections side by side (or stacked on mobile):

### Edit Offset Data
- Number inputs for `X Offset` and `Y Offset`, pre-populated from `read-offset-data` on page load
- **Save** button → calls `save-offset-data`

### Run Offset PDF
- Text input for PDF path (placeholder: `game/output/game.pdf`)
- Number inputs for X and Y offset (optional override)
- Checkbox: "Save offsets to file (-s)"
- **Run Offset PDF** button → calls `run-offset-pdf`, shows loading overlay, alerts on success/error

**File:** `GUI/Home/home.js` (new file)  
Frontend logic for the offset section (IPC calls, form population, button handlers). Add `<script src="home.js">` to `home.html`.

---

## Files Changed

| File | Change |
|------|--------|
| `GUI/CreatePDF/create.html` | Add `--load_offset` checkbox |
| `GUI/CreatePDF/create.js` | Handle `--load_offset` checkbox toggle |
| `GUI/Utilities/ipcHandlers.js` | Add `read-offset-data`, `save-offset-data`, `run-offset-pdf` handlers |
| `GUI/shared/constants.js` | Add `getDataDir()` helper and export |
| `GUI/Home/home.html` | Add Offset Calibration section + script tag |
| `GUI/Home/home.js` | New file — frontend logic for offset section |

---

## Notes

- The `offset_pdf` binary already exists in `GUI/bin/` — no new build step needed.
- Follow the `run-create-pdf` handler pattern exactly for `run-offset-pdf` (chmod, packaged path resolution, env vars).
- `getDataDir()` should mirror the pattern of other dir helpers: dev points to `../../data`, packaged falls back to `userData/data`.
