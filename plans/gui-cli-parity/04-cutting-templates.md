# Plan 04: DXF templates and custom layouts

## Goal and approach

Add a Tools screen for listing and generating DXF templates. Support named sizes, custom card/paper dimensions, corner radius, labels, variant, orientation, saved custom layouts, batch-all, and optimized batch generation. Reuse [generate_dxf.py](/Users/braeburn/repos/silhouette-card-maker/generate_dxf.py) and layout validation.

## Decisions and dependencies

This plan can start independently. Store app-generated templates and layout definitions under user data. Use `SCM_EXTRA_LAYOUTS` and `SCM_CUTTING_TEMPLATES_DIR`; do not write to bundled assets. Existing extra-layout save routing in [generate_dxf.py](/Users/braeburn/repos/silhouette-card-maker/generate_dxf.py) is the starting point. A saved layout must become available in PDF settings without an app rebuild. Read the user's merged catalog at runtime after a save; retain the bundled catalog for initial startup/fallback only.

## File ownership and work

| Subagent | Owned files | Work |
|---|---|---|
| A — Backend | [generate_dxf.py](/Users/braeburn/repos/silhouette-card-maker/generate_dxf.py); proposed `template_worker.py` | Expose list, single, batch, and optimize operations using existing Click validation or shared callable functions. Return paths, dimensions, capacity, orientation, and per-layout errors. Run serially and write only to configured destinations. Provide cancellation between batch items and atomic saved-definition writes. |
| B — Page | Proposed [GUI/Tools/tools.html](/Users/braeburn/repos/silhouette-card-maker/GUI/Tools/tools.html), [GUI/Tools/templates.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Tools/templates.js), [GUI/Tools/tools.css](/Users/braeburn/repos/silhouette-card-maker/GUI/Tools/tools.css) | Add template forms, mutually exclusive named/custom fields, results, batch progress, and output folder controls. Reuse shared controls. Label incompatible layouts clearly. Keep a section boundary for Plan 05. |
| C — Runtime catalog | [GUI/CreatePDF/create.js](/Users/braeburn/repos/silhouette-card-maker/GUI/CreatePDF/create.js), [GUI/shared/pdfCreationSettings.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/pdfCreationSettings.js); proposed [GUI/shared/layoutCatalog.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/layoutCatalog.js) | Refresh merged capabilities after saved layouts change. Preserve the current draft and show invalid selections if a definition is removed. Keep CLI-defined layouts and aliases consistent. |
| D — Tests | Proposed [tests/test_template_worker.py](/Users/braeburn/repos/silhouette-card-maker/tests/test_template_worker.py), [tests/templateTools.test.js](/Users/braeburn/repos/silhouette-card-maker/tests/templateTools.test.js), [tests/template-tools-smoke.cjs](/Users/braeburn/repos/silhouette-card-maker/tests/template-tools-smoke.cjs) | Check dimensions, radii, layout save/reload, batch results, errors, and UI state. |
| Integration owner | [GUI/Utilities/ipcHandlers.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/ipcHandlers.js), proposed [GUI/Utilities/templateWorkerClient.js](/Users/braeburn/repos/silhouette-card-maker/GUI/Utilities/templateWorkerClient.js), [GUI/shared/constants.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/constants.js), [GUI/shared/navbar.js](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/navbar.js), [GUI/main.js](/Users/braeburn/repos/silhouette-card-maker/GUI/main.js), [pdf_worker.py](/Users/braeburn/repos/silhouette-card-maker/pdf_worker.py), build scripts, runners, docs | Register IPC, lifecycle and activity gate, user-data paths, dynamic PDF catalog refresh, Tools navigation, and worker packaging. Keep Windows Studio imports out of this worker. |

## Sequence

1. A specifies request/result fixtures and output layout. Integration owner adds user-data environment settings consistently to both workers.
2. A and B implement backend and page. C adds runtime catalog refresh against fixtures.
3. Integrate single generation before save and batch modes. Reject invalid dimensions before writes.
4. Verify a newly saved custom layout can create a PDF and regenerate the matching DXF in the same session.
5. Add packaging and shutdown checks for an active batch.

## Verification and acceptance

Run the existing DXF/layout tests discovered under `test/`, the new worker suite, `npm test`, and the new Electron smoke. Check default/borderless variants, each orientation, units, corner radius, aliases, impossible layouts, and 12×24 mat limits. Use temporary extra-layout files and assert the bundled assets remain unchanged. Verify batch-all and optimize retain their distinct CLI meanings. Check Unicode output paths and packed worker execution on supported app platforms.

## Execution rules

- This is an implementation plan. No feature code has been changed.
- Each subagent owns only the files assigned to it. Agents share the codebase. Do not revert another agent's edits. The integration agent resolves shared-file changes after each handoff.
- Reuse `GUI/shared/` controls and `GUI/styles/tailwind.css`. Use `paper-button` for HTML and `createButton` from `GUI/shared/button.js` for JavaScript. Keep button states in the shared component.
- Use argument arrays and `shell: false` for processes. Keep logs separate from worker JSON. Keep jobs inside the existing job-activity gate so updates cannot restart the app during work.
- Use temporary folders and stub network services for automated tests. Add new test files to the applicable test runner. Run live service checks separately.
- Finish with a review of the full diff and the acceptance checks below.
