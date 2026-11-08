# Pokémon — completion summary

Status: Implemented. Native release checks remain open.

The shared CardList page now serves MTG and Pokémon. Home groups MTG card search and Text Translation in one game card. The approved descriptive buttons and current numbered navigation are retained.

Shared modules handle controller state, drafts, results, quantities, workflow, and transactional image export. MTG retains face rules and paired filenames. Pokémon uses a separate Python worker and the existing Limitless resolver, including Pocket and old-set sources. Invalid lines and unresolved cards block export. Replace stages all images before moving existing files; failed commits restore prior files. Main-process export validates image sources and decodes PNG data.

Drafts and modes are stored per game. Legacy MTG draft/card data migrates to text. Returning to a saved list runs a fresh lookup instead of restoring provider payloads or stale cache URLs. This keeps cache validation in the resolver. The result, preview, printing, and workflow controls use a few shared modules rather than one file per proposed component.

The frozen card worker is a separate entrypoint. Plugin source files take part in build freshness checks. No local Python is needed for the packaged worker. Existing unrelated edits and the concurrent printing-selector change were retained. No coding branch required a merge; all agents used the shared worktree. The detached prunable worktree was unrelated.

## Validation

- Node contract tests cover shared state, stale searches, retries, MTG printing changes, quantities, face plans, scoped storage, navigation, worker failures, and export rollback.
- Pokémon offline Python tests pass for parsing, strict identity lookup, retries, source fallbacks, cache cleanup, and NDJSON recovery.
- The Electron fixture smoke checks the real Pokémon page, stale-result blocking, two-copy PNG export, fronts-only handoff, Home actions, and the Create PDF route. Fixture images are local; this smoke does not test public providers.
- Live source checks resolved SVI 047 at 460 × 640, Pocket A1 094 at 367 × 512, and old-set BS 44 at 600 × 825. Low-resolution notices are available in the UI.
- CSS and whitespace checks passed. Wider Python checks include the existing PDF worker and creation backend.

## Release checks

Run native Windows and Linux package checks before release. Check native dialogs, keyboard and screen-reader use, and printed output on each release platform. This session does not certify all historical plans or the concurrent printing-selector task.

Final checks: 103 Node tests passed. The combined Pokémon/PDF Python run passed 28 tests with 3 live integration tests deselected. Separate live source checks passed. The standalone frozen worker emitted ready, returned its correlated parse result, and exited successfully without Python. macOS code-signature validation caused about 75 seconds of cold startup. Test logs remain in `/tmp/pokemon-*` and `/tmp/scm-pokemon-*`.

Environment note: `npm run check:entrypoints` starts a rebuild when sources changed. That invocation recreated the local `venv` before it was stopped; requirements were reinstalled. Use the binary-presence API for a read-only presence check. No full rebuild completion is claimed.

The existing PDF preferences Electron smoke passed with the source worker, including real PDF and PNG output. The frozen PDF worker run timed out at generation on this host. Recheck that cold-start path before release; the frozen card worker parse smoke did pass.
