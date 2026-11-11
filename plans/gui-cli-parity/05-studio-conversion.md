# Plan 05: Silhouette Studio conversion

## Goal and approach

Expose the existing Windows-only DXF-to-Studio3 automation in Tools. Support single conversion, batch conversion, missing-output-only mode, dry run, automation calibration, Studio path, calibration path, action delay, units, centering, and registration settings.

## Dependencies and decisions

Use the Tools screen from Plan 04. Keep conversion in a dedicated child process. [dxf_to_studio3.py](/Users/braeburn/repos/silhouette-card-maker/dxf_to_studio3.py) exits on non-Windows import, so never import it from the shared PDF or template worker. On macOS/Linux, show an unavailable message and instructions to open a DXF manually. This project does not add cross-platform Studio automation.

The process controls another app's mouse and keyboard. The UI must explain this before launch and provide a clear start action and stop action. Reuse the existing automation limits, including its fixed window size. Calibration is interactive; preserve its prompts through explicit structured prompt/reply events rather than hide stdin prompts behind an IPC call.

## File ownership and work

| Subagent | Owned files | Work |
|---|---|---|
| A — Automation backend | [dxf_to_studio3.py](/Users/braeburn/repos/silhouette-card-maker/dxf_to_studio3.py); proposed `studio_worker.py` | Extract reusable command execution and calibration prompt hooks. Preserve CLI prompts/defaults. Emit structured progress, current file, output, error, and calibration prompts. Handle dry run without mouse/keyboard actions. Check stop requests between actions and preserve existing fail-safe behavior. |
| B — UI | Proposed [GUI/Tools/studio.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Tools/studio.js); [GUI/Tools/tools.html](/Users/braeburn/repos/silhouette-card-maker/GUI/Tools/tools.html), [GUI/Tools/tools.css](/Users/braeburn/repos/silhouette-card-maker/GUI/Tools/tools.css) | Add Windows capability state, single/batch forms, dry-run preview, conversion progress, calibration steps, start/stop, and output links. Explain screen-size and app-focus needs. Distinguish printer calibration from Studio automation calibration. |
| C — Process client | Proposed [GUI/Utilities/studioClient.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/studioClient.js), [tests/studioClient.test.js](/Users/braeburn/repos/silhouette-card-maker/tests/studioClient.test.js) | Implement argument arrays, streamed events, prompt replies, process-tree cleanup on Windows, bounded shutdown, and abnormal-exit handling. Prevent concurrent Studio jobs. |
| D — Backend tests | Proposed [tests/test_studio_worker.py](/Users/braeburn/repos/silhouette-card-maker/tests/test_studio_worker.py), [tests/studio-tools-smoke.cjs](/Users/braeburn/repos/silhouette-card-maker/tests/studio-tools-smoke.cjs) | Stub Studio and automation calls. Test input validation, prompt lifecycle, dry run, batch selection, cancellation, and unsupported platforms. |
| Integration owner | [GUI/Utilities/ipcHandlers.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/ipcHandlers.js), [GUI/main.js](/Users/braeburn/repos/silhouette-card-maker/GUI/main.js), shared path helpers, [build_entrypoints.sh](/Users/braeburn/repos/silhouette-card-maker/build_entrypoints.sh), [build_entrypoints.bat](/Users/braeburn/repos/silhouette-card-maker/build_entrypoints.bat), [check_and_build_entrypoints.js](/Users/braeburn/repos/silhouette-card-maker/check_and_build_entrypoints.js), [GUI/package.json](/Users/braeburn/repos/silhouette-card-maker/GUI/package.json), runners, docs | Wire trusted IPC and job activity. Package Studio tooling only on Windows and ensure entrypoint checks do not require it elsewhere. Reuse Plan 04 template paths. |

## Sequence

1. A publishes event and prompt schemas; C supplies a fixture process before UI work connects.
2. A, B, and C implement their isolated parts. Merge dry run first, then single conversion, calibration, and batch conversion.
3. Verify stop semantics: keep completed files, report the interrupted file, and avoid leaving held keys or buttons. Do not promise recovery of unsaved Studio state.
4. Run the real Windows acceptance checks below before marking automation complete.

## Verification and acceptance

Run new process-client and worker tests plus `npm test`. Non-Windows tests must not import the Windows module. On Windows with Studio installed, verify single conversion, default/borderless layouts, registration settings in both unit systems, successful calibration reuse, batch missing-only behavior, stop during a job, and an invalid Studio path. Open resulting `.studio3` files and inspect page dimensions and cut paths. Record manual checks that require the user's Studio installation; stubs alone do not complete this plan.

## Execution rules

- This is an implementation plan. No feature code has been changed.
- Each subagent owns only the files assigned to it. Agents share the codebase. Do not revert another agent's edits. The integration agent resolves shared-file changes after each handoff.
- Reuse `GUI/shared/` controls and `GUI/styles/tailwind.css`. Use `paper-button` for HTML and `createButton` from `GUI/shared/button.js` for JavaScript. Keep button states in the shared component.
- Use argument arrays and `shell: false` for processes. Keep logs separate from worker JSON. Keep jobs inside the existing job-activity gate so updates cannot restart the app during work.
- Use temporary folders and stub network services for automated tests. Add new test files to the applicable test runner. Run live service checks separately.
- Finish with a review of the full diff and the acceptance checks below.
