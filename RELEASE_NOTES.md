# Silhouette Card Maker 1.2.0

November 8, 2026

## New features

- Select MTG printings in a side panel with an image for each printing, search, sorting, and a larger preview. Click a card image to open it.
- Load printings in batches. The default is 25. Change Printings per load in Settings. Load more disappears at the end.
- Reuse card images from a memory cache across previews, selection, page changes, and export. Closing all windows or quitting clears the cache.
- Show loading spinners while card images load.
- Import Pokémon Limitless deck lists through the shared card-list page, including supported Pocket and old-set sources.
- Configure PDF page layout, image options, and file destinations in a preferences dialog with a page preview, search, and Save/Cancel actions.
- Create PNG pages as well as PDFs, with custom destinations and clear completion feedback.

## Fixes

- Keep exact collector numbers, quantities, and paired card faces when changing printings.
- Prevent older requests from replacing a newer card choice or deck list.
- Handle Unicode image filename headers without the Electron ByteString crash.
- Stage image exports before replacing existing files and restore files if a commit fails.
- Preserve separate game drafts and printing workflows.
- Load PDF settings and the layout preview without waiting for Python startup.

## Release checks

Node tests and local Electron fixture checks cover the new printing flow, cache, settings, and shared card-list behavior. Native Windows/Linux packaging, physical print quality, and packaged upgrade checks remain release checks. These notes describe the source release; platform installers are built separately.
