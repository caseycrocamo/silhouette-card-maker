"use strict";

function createLoadingIndicator(doc, text = "Loading image…") {
  const indicator = doc.createElement("span");
  indicator.className = "loading-indicator";
  indicator.setAttribute("role", "status");
  const spinner = doc.createElement("span");
  spinner.className = "loading-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const label = doc.createElement("span");
  label.textContent = text;
  indicator.append(spinner, label);
  return indicator;
}

module.exports = { createLoadingIndicator };
