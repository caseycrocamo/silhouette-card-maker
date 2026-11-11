# Container integration tests

Run `npm run test:integration` from the repository root. Docker must be running. The first run builds a Linux image with Node 22, Python 3.13, pinned Python and GUI dependencies, Cairo, fonts, Xvfb, and a freshly frozen PDF worker.

Each test runs sequentially in its own container. This includes each Python parameter case, each top-level Node test, and each UI scenario. No test container has network access, host mounts, shared writable volumes, or access to the Docker socket. The container is removed before the next test starts, including after failure or timeout. Thus source files, images, PDFs, calibration, browser storage, environment settings, and temporary files return to the image baseline. A worker recovery scenario intentionally sends several requests within one test.

The image excludes local game data, saved settings, host executables, dependency folders, and build output. Test fixtures are baked into the image. Dependency caches exist only at build time; test state is never reused. Dependencies and source changes require a rebuild. Use `--no-build` only to rerun the same image.

The suite includes the JavaScript checks in `npm test`, Python tests excluding the `slow` marker, text-box PDFs for all paper sizes, a real frozen-worker create/offset/reuse test with Unicode paths and saved angle, validation and recovery tests, and Electron UI scenarios. Provider tests use synthetic JSON and image responses from `test/provider_mocks.py`. A test fixture blocks sockets and unmocked HTTP requests. The `integration` marker identifies checks across the parser, API adapter, and file writer; these checks also run offline. This Linux suite does not replace native macOS and Windows packaging checks.

Examples:

- `npm run test:integration -- --suite ui`
- `npm run test:integration -- --suite worker --no-build`
- `npm run test:integration -- --suite python --match invalid_options`

The runner continues after a failed test and returns a nonzero exit code if any test fails. A JSON result file is written after each case to `/tmp/silhouette-integration-results.json`; use `--results PATH` to change it. Every case has a timeout. Console output includes each selected test and its result. No matching tests is an error.

UI cases cover Home navigation, image import and removal, cancelled file selection, PDF flags and front-only layout, invalid create arguments, settings save and offset errors, Markdown validation and PDF generation, decklist search and missing cards, repeated printing changes, PDF viewer selection, and update controls. Real PDF output is parsed with PDFium. File-picker responses and card API responses use local fixtures; native OS dialogs and live third-party services are outside this suite. The printing regressions also cover multi-copy quantities, export counts, resubmission, failed selection rollback, and out-of-order responses.
