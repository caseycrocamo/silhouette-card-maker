# Navbar redesign implementation plan

## TL;DR

Replace the shared navbar with the approved [single-line mockup](/Users/braeburn/repos/silhouette-card-maker/designs/navbar-concepts/completion/05-single-line-check-badge.png). Keep numbered steps, dotted connectors, the bright active pill, and a small check badge below the number of each earlier step. Group Templates and Settings in one control. Keep the existing app colors and routes.

This plan covers the shared navbar and the page spacing needed to fit it. It does not include the mockup's card-list body or its presentation title.

## Steps

### Phase 1 — Define step state and preserve routing

1. Update `Navbar.updateActiveState()` and `updateContent()` in the shared navbar. Map Home to step 1, CardList and MagicTheGathering to step 2, and CreatePDF to step 3. Map Settings and Tools explicitly to utility views. Tools currently uses `current-step="4"`; it must not appear as a fourth process step.
2. Keep the current game selection rules: explicit valid CardList query parameter first, saved valid game second, and MTG fallback. Preserve the special MTG route behavior. Keep all three steps as links, as they are today.
3. Define visual states from the current process position. An earlier step gets its number and check badge; the current step gets the filled pill; a later step gets an outlined number. On Settings and Tools, show neutral process steps and highlight the correct utility link. Do not add saved completion state.

Dependency: settle these rules before rendering the new states. A check means an earlier stage in the displayed route, not a verified card search or PDF export.

### Phase 2 — Build the shared navbar

4. Replace the hover-expanded labels in `renderStep()` with labels that remain visible: Choose Game, Card List, Create PDF. Render an ordered list inside a navigation landmark. Add `aria-current="step"` to the current process link. Supply screen-reader-only completion text for earlier steps. Hide decorative icons and connectors from assistive tools.
5. Match the approved first-step marker: an outlined number circle with a small filled check badge overlapping its lower right edge. Keep the number visible. Put no check after the label. Render no visible Complete, Current, Next, or Step 1 done subtext. Apply the same completed marker to steps 1 and 2 when step 3 is active.
6. Add the Silhouette wordmark at the left as plain identity text. Use dotted vertical separators and dotted horizontal step connectors. Keep the active pill distinct from the two outlined number circles. Use the existing surface and content tokens; add no accent colors or new fonts.
7. Group Templates and Settings as two independent links inside one rounded dashed border, with one internal divider. Keep their existing destinations and descriptive accessible names, including Cutting templates. Use consistent outline icons. This is a direct-link group, not a dropdown.
8. Reuse shared `paper-button` styles for the utility links. If needed, add a shared grouped-button modifier in `tailwind.css` that owns the outer border, divider, corner treatment, and focus behavior. Keep colors, hover, focus, and active states in the shared component. Navbar-specific CSS controls layout only. If renderer-created native buttons are needed, use `createButton`; the planned navigation uses anchors.

Dependency: phase 1 first. Keep changes in the shared component and shared stylesheet so every page receives the same navbar.

### Phase 3 — Fit the navbar across pages

9. Use a three-part desktop layout: identity, flexible step list, utility group. Keep labels visible without hover. At narrower widths, place the process steps on a second row and keep the identity and utility group on the first. At small widths, wrap utility labels if needed and reduce gaps, while keeping the three ordered step labels readable and controls at least 44 pixels high. Do not use horizontal page scrolling.
10. Replace fixed `pt-24` page assumptions with one shared navbar clearance rule. Prefer a shared CSS height variable updated from the rendered navbar with `ResizeObserver`, with a safe CSS fallback. Apply that clearance to all six navbar pages. Disconnect the observer when the navbar is removed.
11. Replace the update banner's fixed `top-20` and height calculation with the same navbar height variable plus a small gap. Verify that it stays below both one-row and wrapped navbars. Preserve the update subscription and notification behavior; do not expand this task into update-service changes.

Dependency: phase 2 first. Page clearance and banner positioning must ship with the new layout.

### Phase 4 — Verify and review

12. Extend existing navigation tests for process states and utility routes. Keep their current coverage of game selection. Add an Electron navbar smoke test for rendered layout, keyboard navigation, and page clearance. Follow the existing Electron smoke harness and stub update IPC so checks do not require network access.
13. Build CSS, run the checks below, and capture screenshots of each process stage plus Settings and Tools. Compare the desktop Card List screenshot with the approved PNG. Fix layout and state errors before handing off.

## Relevant Files

- [Approved PNG](/Users/braeburn/repos/silhouette-card-maker/designs/navbar-concepts/completion/05-single-line-check-badge.png): design reference only.
- [Shared navbar](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/navbar.js): `updateActiveState`, `updateContent`, `renderStep`, and update banner position.
- [Shared styles](/Users/braeburn/repos/silhouette-card-maker/GUI/styles/tailwind.css): paper controls, grouped utility links, navbar layout, and shared clearance.
- [Button factory](/Users/braeburn/repos/silhouette-card-maker/GUI/shared/button.js): use for any native buttons introduced during implementation.
- [Theme](/Users/braeburn/repos/silhouette-card-maker/GUI/tailwind.config.js): existing palette and content scanning. No palette change is planned.
- [Home](/Users/braeburn/repos/silhouette-card-maker/GUI/Home/home.html), [Card List](/Users/braeburn/repos/silhouette-card-maker/GUI/CardList/decklist.html), [Translation](/Users/braeburn/repos/silhouette-card-maker/GUI/MagicTheGathering/text_translation.html), [Create PDF](/Users/braeburn/repos/silhouette-card-maker/GUI/CreatePDF/create.html), [Settings](/Users/braeburn/repos/silhouette-card-maker/GUI/Settings/settings.html), [Tools](/Users/braeburn/repos/silhouette-card-maker/GUI/Tools/tools.html): replace fixed top padding with shared clearance; normalize Tools' process-step attribute.
- [Navigation tests](/Users/braeburn/repos/silhouette-card-maker/tests/cardNavigation.test.js): preserve its VM-based route test pattern and extend its DOM stubs only as needed.
- [Tools smoke harness](/Users/braeburn/repos/silhouette-card-maker/tests/template-tools-smoke.cjs): example Electron window and update IPC stub.
- Proposed `/Users/braeburn/repos/silhouette-card-maker/tests/navbar-smoke.cjs`: DOM, layout, and keyboard checks.
- [Root scripts](/Users/braeburn/repos/silhouette-card-maker/package.json): add `test:navbar-ui` using the existing Electron smoke script pattern.
- Generated `/Users/braeburn/repos/silhouette-card-maker/GUI/styles/main.css`: rebuild through the CSS command; do not edit directly.

## Verification

- Run `npm run build:css`.
- Run `node --test tests/cardNavigation.test.js tests/updateControls.test.js`.
- Run the new `npm run test:navbar-ui`.
- Run `npm run test:card-list-ui` and `npm run test:template-tools-ui` to check the two main navigation integrations.
- Check steps 1, 2, and 3: zero, one, and two completed badges respectively; exactly one active process link. Check Settings and Tools: no active process link, correct utility active state.
- Confirm explicit game parameters, saved plugin games, MTG translation, and unknown-game fallback still produce the correct Card List link.
- Check all six pages at 1440, 1024, 768, and 375 pixels wide. Assert that navbar items do not overlap, labels remain visible, document width fits the viewport, and the first main-content element starts below the navbar. Check at 200 percent zoom.
- Tab through the navbar. Check visible focus, link order, Enter activation, accessible names, and current-step announcements. Confirm no hover action is required to read a step label.
- Show an update banner at desktop and narrow widths. Confirm it does not cover the navbar and its actions still work.
- Compare the Card List screenshot against the PNG: dotted motifs, slate colors, grouped utilities, no visible step status subtext, and check badges below number circles.

## Decisions

- Use the latest corrected PNG, including the shared Templates / Settings group.
- Preserve the process numbers. Keep labels on one line where space permits; wrap the navbar rather than hide labels.
- Use route position for completion markers. Existing routes do not establish persistent completion, and this task does not add workflow validation.
- Keep navigation access unchanged. Do not block forward links or alter card-list and PDF page validation.
- On utility pages, show neutral process navigation. Do not imply that opening Settings completes the process.
- Keep unrelated working-tree changes intact, including existing changes in `AGENTS.md` and `create_pdf`.
- This is a plan only. Application implementation has not started.

## Further Considerations

No blocking questions remain. The narrow layout is an adaptation of the desktop mockup; review its screenshots before accepting the implementation. If persistent, validated completion is wanted later, treat that as a separate workflow change.
