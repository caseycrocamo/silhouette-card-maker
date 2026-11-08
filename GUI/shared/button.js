"use strict";

// Native buttons share the app's paper-button component and its interaction states.
// Static HTML uses the same classes; renderer-created buttons use this factory.
const BUTTON_CLASSES = Object.freeze({
  default: "paper-button",
  compact: "paper-button paper-button--compact",
  icon: "paper-button paper-button--icon",
  image: "paper-button paper-button--image",
});

function createButton(
  {
    text = "",
    id,
    size = "default",
    ariaLabel,
    disabled = false,
    onClick,
  } = {},
  ownerDocument = document,
) {
  if (!Object.hasOwn(BUTTON_CLASSES, size))
    throw new Error(`Unknown button size: ${size}`);
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASSES[size];
  button.textContent = text;
  button.disabled = disabled;
  if (id) button.id = id;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

module.exports = { createButton, BUTTON_CLASSES };
