# Plan 05 completion record

Status: implemented; Windows acceptance and packaged validation remain open.

- Added a Windows-only, one-job JSON worker. It loads the existing automation module only on Windows. Single and batch jobs use the CLI paper, orientation, borderless, registration, and missing-output rules. Dry run lists candidates without starting Studio or sending input.
- Added Studio controls to Tools with executable/calibration paths, units, page controls, action delay, dry run, progress, output locations, and stop. macOS/Linux show manual-conversion instructions and disable automation.
- Added structured version and element prompts for automation calibration. Record waits three seconds so the pointer can move from the app to the Studio control. Skip retains saved positions; Back repeats the prior step. Interrupted calibration does not replace the saved JSON.
- Added stop checks before mouse/keyboard actions and during waits. Stop releases modifiers/buttons, keeps completed files, and leaves the Studio document for inspection. The client prevents concurrent jobs, rejects stale prompt replies, reports abnormal exits, and uses bounded Windows process-tree termination when graceful stop fails.
- Electron quit now waits for worker stop promises before a guarded final quit. Repeated quit requests do not repeat cleanup, and a stalled stop has a five-second outer limit.
- Shared integration is in `GUI/Utilities/parityIpc.js`, app shutdown, build discovery, and test runners. The worker has a static import inside its Windows-only route so PyInstaller can find the automation dependencies. Non-Windows entrypoint discovery excludes both Studio scripts.

Checks passed on macOS:

- `venv/bin/python -m pytest tests/test_studio_worker.py -q`: 16 tests.
- Node 20: `node --test tests/studioClient.test.js`: 7 tests.
- Node 20: `node --test tests/appShutdown.test.js tests/pdfWorkerShutdown.test.js`: 5 tests, including active Studio cleanup, repeated quit, bounded failure, and preserved update drain checks.
- `GUI/node_modules/.bin/electron tests/studio-tools-smoke.cjs`: unsupported host, dry-run UI, calibration prompt/reply, and stop. Uses local IPC fixtures; no Studio automation runs.

Still required on Windows with Studio installed:

1. Build and launch the packaged worker without local Python.
2. Convert default and borderless single/batch layouts in mm and inches; inspect output page dimensions and cut paths in Studio.
3. Record/reuse calibration at 1920 × 1080, including the three-second pointer capture, Skip, and Back.
4. Check missing-only selection, invalid executable paths, ordinary stop, fail-safe stop, and forced cleanup. Inspect the interrupted document and confirm no keys or buttons stay held.

No real Windows conversion or native packaged Studio check was possible on this macOS host.
