# One combined persistent PDF worker process

## Context

The Electron GUI spawns a fresh subprocess every time the user clicks "Create PDF" or runs an offset
calibration. Both `create_pdf` and `offset_pdf` are `--onefile` PyInstaller executables. Measured on
this machine, launching `GUI/bin/offset_pdf` takes **~12 seconds wall-clock** per invocation, while
actual CPU time is under 1s (user 0.6s, sys 0.3s) — `spctl -a` reports the binary as "rejected"
(ad-hoc signed, not notarized), so the gap is macOS Gatekeeper/security-scan overhead compounded by
PyInstaller onefile's self-extraction-to-tempdir on every launch. This makes the offset-calibration
workflow — where a user repeatedly nudges x/y and re-runs the tool (`GUI/Settings/settings.js`) —
painfully slow, since every nudge re-pays the full ~12s tax.

The fix: replace per-click subprocess spawning with **one long-lived worker process**, started once
at app launch (hidden behind the home screen loading), that services both create_pdf and offset_pdf
requests over stdin/stdout for the rest of the session. `create_pdf.py` and `offset_pdf.py` stay
**completely unmodified** — the worker imports them as library modules rather than re-implementing
their logic, so there's no risk of behavioral drift between the CLI tools and the GUI path.

---

## New file: `pdf_worker.py` (repo root)

Imports `from create_pdf import cli as create_pdf_cmd` and `from offset_pdf import offset_pdf as
offset_pdf_cmd` (both `click.Command` objects, unmodified). After imports succeed (this is where the
~12s one-time tax is paid), emits `print(json.dumps({"ready": True}), flush=True)`.

Main loop: `for line in sys.stdin:` — parses one JSON request per line, dispatches, writes one JSON
response line, flushes. Exits cleanly on stdin EOF (this is also the orphan-cleanup backstop if the
parent Electron process dies uncleanly).

Dispatch on `req["command"]`, each branch capturing stdout via
`with contextlib.redirect_stdout(io.StringIO()) as buf:` and returning `{"ok", "log", "error"}`:

- **`"create_pdf"`**: `req["args"]` is an argv array (tokenized the same way the current
  `ipcHandlers.js` regex already does). Invoke via Click's own parser rather than hand-mapping every
  `@click.option` (avoids drift if `create_pdf.py`'s options ever change):
  `ctx = create_pdf_cmd.make_context("create_pdf", list(args)); create_pdf_cmd.invoke(ctx)`.
  Wrap in try/except → `ok=False, error=str(e)` on any exception (including Click's own
  `UsageError` for bad args). `create_pdf.py`'s `cli` raises normally on failure — no swallowing.

- **`"offset_pdf"`**: call the raw callback directly (bypasses Click's argv parsing/`sys.exit`):
  `offset_pdf_cmd.callback(pdf_path=..., output_pdf_path=..., x_offset=..., y_offset=..., save=..., ppi=...)`.
  Because `.callback` bypasses Click's default-filling, the worker must supply every parameter
  explicitly (`output_pdf_path=None, x_offset=None, y_offset=None, save=False, ppi=300` when the
  request omits them). Note `offset_pdf.py` **swallows `FileNotFoundError`** internally and just
  prints `"Cannot offset nonexistent PDF: ..."` instead of raising — so success/failure of the
  *file* is only visible in the captured print log, not via exception. Set `ok=True` unless an
  *unexpected* exception escapes the callback; let the Node side/renderer interpret `log` content
  exactly as it does today.

Broad `except Exception` around each dispatch branch so one bad request can't kill the loop. Unknown
command → `{"ok": False, "log": "", "error": "unknown command: <x>"}`.

This is deliberately **single-threaded, one request at a time** — `contextlib.redirect_stdout` swaps
the process-global `sys.stdout`, which is only safe because nothing else runs concurrently. Do not
add threading to this worker without redesigning stdout capture.

---

## New file: `GUI/Utilities/pdfWorkerClient.js`

The only module `ipcHandlers.js` talks to for these two flows. Encapsulates worker lifecycle, a
strict FIFO one-in-flight request queue, and crash recovery.

- **`resolveWorkerPath()`** — factors out the path/exe-name/`isPackaged` logic currently duplicated
  at `ipcHandlers.js` ~116-121 and ~193-198, pointed at a single `pdf_worker`/`pdf_worker.exe`.
- **`startPdfWorker()`** (idempotent) — `chmodSync` on non-win32 (wrapped in try/catch like today),
  `spawn(exePath, [], { cwd, env: { ...process.env, CARD_MAKER_FRONT_DIR: getFrontDir(), ...
  BACK/OUTPUT/DOUBLE_SIDED/DATA } })` using the same `GUI/shared/constants.js` getters as today.
  Attach `readline.createInterface({ input: worker.stdout })` for clean line-by-line framing (not raw
  `'data'` handlers — responses can span multiple data events, and readline handles Windows `\r\n`).
  Track a `readyPromise` resolved when the `{"ready":true}` line arrives.
- **FIFO queue** — `sendRequest(req)` ensures the worker is started, pushes `{req, resolve, reject}`
  onto an array, calls `pump()`. `pump()` no-ops unless ready, idle, and non-empty; otherwise pops the
  next job and writes `JSON.stringify(req) + "\n"` to `worker.stdin`. Correlation between request and
  response is purely by strict ordering (the worker handles exactly one request per response, in
  sequence) — no request IDs needed.
- **Crash recovery** (`worker.on('exit'/'error')`) — reject in-flight + all queued jobs with a clear
  message including captured stderr. Immediately kick off a fresh `startPdfWorker()` in the
  background (eager respawn) so the next click is already warm, with a short backoff and an attempt
  cap; after repeated failures, stop auto-respawning and surface a clear error to the next caller
  instead of spinning forever.
- **`stopPdfWorker()`** — `worker.stdin.end()` (triggers the worker's EOF-exit path), then
  `SIGKILL` after a short grace timeout if still alive.
- Exports: `{ startPdfWorker, stopPdfWorker, runCreatePdf(argv), runOffsetPdf({pdfPath, xOffset, yOffset, save}) }`.

---

## Changes to `GUI/main.js`

`require('./Utilities/pdfWorkerClient')`. In `app.whenReady()`, call `createWindow()` first, then
`startPdfWorker()` **without awaiting** (fire-and-forget) — the window paints immediately; the ~12s
tax runs in the background behind the home screen. Add `stopPdfWorker()` to `app.on('before-quit', ...)`
and inside the existing `window-all-closed` handler before `app.quit()`.

## Changes to `GUI/Utilities/ipcHandlers.js`

Replace the `spawn()` bodies of `run-create-pdf` (currently ~108-160) and `run-offset-pdf`
(currently ~188-251), deleting the now-duplicated path/chmod/env logic (it lives once in
`pdfWorkerClient.js` now). Both handlers keep their **exact current resolve(string)/reject(string)
contract** — critical because neither renderer file needs to change:

```js
// run-create-pdf: keep existing argv tokenization unchanged
const args = argsString.match(/(?:[^"\s]+|"[^"]*")+/g) || [];
const resp = await runCreatePdf(args);
if (resp.ok) return resp.log;
throw new Error(resp.error || 'Exited with error');
```

```js
// run-offset-pdf
const resp = await runOffsetPdf({ pdfPath, xOffset, yOffset, save });
if (resp.ok) return resp.log;   // must still contain "Offset PDF: <path>" on success
throw new Error(resp.error || 'Exited with error');
```

Verified against the actual renderer code: `GUI/Settings/settings.js:45-51` does
`ipcRenderer.invoke('run-offset-pdf', { pdfPath }).then(stdout => stdout.match(/Offset PDF: (.+)/))`
— since `offset_pdf.py` prints exactly `Offset PDF: {output_pdf_path}` and the worker captures that
print into `resp.log`, the regex still matches unchanged. `GUI/CreatePDF/create.js:193` just awaits a
resolved value and navigates — no parsing of the result, so returning `resp.log` is safe.

The unrelated `run-md-to-pdf` handler (~253-349, `translated_text_boxes_to_pdf` binary) is untouched.

## Packaging — no changes needed

Confirmed both auto-discovery mechanisms key off the same regex and need no edits:
- `build_entrypoints.sh:46-52` auto-discovers any root `.py` with `if __name__ == '__main__':` and
  builds it `--onefile` — `pdf_worker.py` becomes a third target automatically.
- Root `package.json`'s `copy:entrypoints` script uses the identical regex to find entrypoints and
  copy `<base>`/`<base>.exe` into `GUI/bin`; `pdf_worker`/`pdf_worker.exe` are staged automatically.
- `GUI/package.json`'s `extraResources` copies the whole `bin` directory, so packaged builds pick up
  `pdf_worker` with no enumeration to edit.

`create_pdf` and `offset_pdf` standalone binaries remain built and shipped for direct CLI use — they
are simply no longer what the GUI spawns per click.

---

## Risks to keep in view during implementation

- **Native (C-level) writes to fd 1 would bypass `redirect_stdout`** (only reroutes Python-level
  `sys.stdout`; `pypdfium2` is a C library). Both scripts only use Python `print()` today, so this is
  latent, not active — but on the Node side, treat any stdout line that fails `JSON.parse` as stray
  noise rather than rejecting the in-flight request, as a defensive measure.
- **Click `.callback` bypasses defaults for offset_pdf** — the worker's explicit kwarg list must be
  updated if `offset_pdf.py` ever gains a new `@click.option` (asymmetric with create_pdf, which is
  drift-proof via `make_context`).
- **`create_pdf.py` reads `CARD_MAKER_*` env vars at import time** (lines 8-13) — safe since the
  worker is spawned once with a stable env computed from `constants.js` getters, which only depend on
  `app.getPath('userData')` and are stable for the app's lifetime.
- **Orphan cleanup on hard crash** — `before-quit` won't fire on `kill -9`; the worker's stdin-EOF
  loop exit (`for line in sys.stdin` ends cleanly on EOF) is the backstop.

---

## Verification (manual, end-to-end)

1. Launch the app — home window appears immediately, not blocked ~12s. Confirm (via temp logging)
   the worker's ready signal arrives a few seconds *after* the window is already visible.
2. Click Create PDF immediately after launch, before the worker is likely ready — request should
   queue and complete once ready; output PDF appears in the output dir.
3. Run offset calibration on the default calibration PDF — confirm navigation to
   `pdf_viewer.html?path=...` (i.e., the `/Offset PDF: (.+)/` regex matched).
4. Run offset 3-4 times rapidly with different x/y values — each should return in well under a
   second after the first (this is the actual goal of the change).
5. Trigger two actions in quick succession — confirm both complete with correct, non-swapped outputs
   (FIFO ordering holds).
6. Offset a nonexistent PDF path — confirm the existing "Cannot offset nonexistent PDF" alert still
   appears. Create a PDF with an invalid `--card_size` — confirm the create.js error alert fires.
7. `kill -9` the `pdf_worker` process mid-session — confirm the in-flight action rejects with a clear
   error, and the next action succeeds after an automatic respawn.
8. Quit the app normally — `ps aux | grep pdf_worker` shows nothing running.
