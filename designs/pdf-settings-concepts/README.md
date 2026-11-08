# PDF settings concepts

These are static review mockups. The running app was not changed.

1. **Preferences window:** A modal with a category sidebar and Save/Cancel actions. Recommended for a familiar desktop settings flow.
2. **Tabbed dialog:** A modal with category tabs and a sheet diagram beside the controls. Apply returns to the card screen.
3. **Dedicated settings view:** A full settings page with a category sidebar, saved-state feedback, and a clear return action.

All three retain Page layout, Image settings, and File settings. Each PNG shows Page layout; the other categories use the same row-based form pattern. Advanced page options contain skipped positions, labels, and cutting outlines. Sheet diagrams are illustrative.

Recreate the PNG files by running `python3 designs/pdf-settings-concepts/build.py`, then `GUI/node_modules/.bin/electron designs/pdf-settings-concepts/render.cjs` from the repository root. Screenshots use local HTML/CSS and system fonts, with no generated image assets or network requests.

Selected refinement: `04-preferences-preview.png` combines the category sidebar and Save/Cancel flow of concept 1 with the page preview of concept 2. The preview column remains visible while the settings content scrolls. Front and Back selectors show the intended preview navigation.
