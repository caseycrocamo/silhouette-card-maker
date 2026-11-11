# Navbar redesign completion summary

Status: Completed on November 11, 2026.

The shared navbar now has visible numbered steps, route-based check badges, a bright active pill, dotted connectors, the Silhouette wordmark, and grouped Templates and Settings links. Utility routes keep the process steps neutral. Valid query games take precedence over valid saved games, then MTG; translation retains its MTG route.

The navbar wraps at narrow widths. Shared measured clearance serves all six pages, the update banner, and the deck beside the printing drawer. Removal disconnects observers, listeners, and update subscriptions. Utility links use shared paper-button styles; update actions use createButton.

## Validation

- CSS build and whitespace checks passed.
- Full Node suite: 192 passed with Node 22.23.4.
- Navbar Electron smoke passed for all six pages at 1440, 1024, 768, and 375 pixels, plus 200 percent zoom at a 1440-pixel window.
- Smoke checks cover route states, visible labels, text and link overlap, target height, page clearance, Tab order, visible focus, Enter activation, banner placement/actions, and removal/reconnection.
- Existing Card List, template tools, and printing selector Electron smokes passed. The latter two emit existing missing capability-stub messages; they exit successfully.
- Thirty screenshots are in `/tmp/navbar-redesign-review`. Desktop Card List was compared with the approved PNG. A 375-pixel wordmark overlap found during review was fixed and covered by a text-range check.
- Independent source and visual review found no remaining issues.

All agents used the shared worktree. No branch merge was needed. Existing changes in AGENTS.md, create_pdf, and design assets were preserved. Generated main.css was rebuilt; it remains ignored by Git.

## Compact menu revision

At the user's request, viewports below 1280 pixels now hide the Silhouette wordmark and place Templates and Settings behind a hamburger button. The three process links remain visible. The expanded utility group stays in the navbar flow, so page and update-banner clearance adjusts with it.

The shared button exposes its expanded state and controlled links. Escape returns focus to the button; outside pointer input closes the group. Desktop resize restores the direct links and resets the compact menu. Document listeners are removed when the navbar disconnects. This revision replaces the original plan's direct-link-only requirement at compact widths.

Validation for the compact revision: all 192 Node tests pass. The offline navbar smoke passes all six pages at 1440, 1280, 1279, 1024, 768, and 375 pixels, plus 200 percent zoom. It checks closed/open states, keyboard Enter and Space, Escape focus return, outside dismissal, desktop reset, navigation, and cleanup. Updated screenshots are in `/tmp/navbar-menu-review`. Independent review found no open issues. The macOS app was rebuilt and opened.

## Sidebar revision

The user requested a sidebar in place of the expanded utility row. The compact interaction now uses a right sidebar with a wipe transition. While it is open, the navbar takes the app background color and hides its process elements. The hamburger changes into an X in the same position. Closing restores the process navigation.

The sidebar traps keyboard focus, preserves prior inert states, and locks background scrolling while open. Escape, the X, or the backdrop closes it. Desktop resize and component removal restore the page. Reduced-motion settings remove transitions. The full 192-test Node suite and sidebar Electron checks pass, including animation keyframes, reduced motion, focus, restoration, and navigation. Final screenshots are in `/tmp/navbar-sidebar-review`.

## Dotted edge revision

The navbar erase now uses a moving dotted vertical edge. It starts at the navbar's right border and sweeps across the header, then beyond the left screen edge. The mask behind it uses the app background. The original steps, border, and surface remain painted until the edge passes. Closing reverses the sweep. The sidebar and hamburger-to-X animation retain their existing behavior. Reduced-motion settings skip the transition.

Validation: 192 Node tests and the complete Electron navbar smoke pass. Deterministic animation checks inspect the start, midpoint, off-screen finish, reverse close, and rapid toggles. The midpoint screenshot confirms the dotted leading edge and the un-erased navbar ahead of it. Updated screenshots are in `/tmp/navbar-edge-review`. CSS and the macOS app were rebuilt.

Final visual adjustments set the erase wipe to 180 ms, match its color to the page under the sidebar backdrop, and increase connector clearance at all widths. CSS and the local app were rebuilt and refreshed. Tests were skipped for these final adjustments at the user's request; the earlier 192-test and Electron results above predate them. The smoke color expectation now follows the dimmed page surface.
