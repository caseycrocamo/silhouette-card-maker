# Printing selector concepts

PNG design mocks made with the built-in image generation tool. Card art and metadata are illustrative.

1. `01-printing-gallery.png`: A gallery dialog with a full card preview for each printing and a larger preview for the selected option.
2. `02-printing-drawer.png`: A side panel with a card preview in each list row. The deck stays visible beside the panel.

Both concepts keep distinct collector numbers from the same set. A checkmark and outline show the selected option. Use this printing applies the choice to the card entry. Cancel keeps the current printing.

The `-v2.png` files remove the redundant Selected label. They use a checkmark to show the choice.

Use the existing shared paper-button style for controls if implemented. Keep previews visible without hover. Support keyboard selection, visible focus, image loading placeholders, and a retry action if a preview fails to load. For cards with two faces, add Front and Back controls to the larger preview.

Full generation prompts are in `prompts.json`.
