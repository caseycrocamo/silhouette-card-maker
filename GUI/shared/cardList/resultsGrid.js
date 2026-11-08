"use strict";
const { createButton } = require("../button");
const { setCardImage } = require("../cardImages");
const { createLoadingIndicator } = require("../loadingIndicator");
function renderResults(
  container,
  state,
  { adapter, onPrinting, onPrintingExact, onRetry },
) {
  const doc = container.ownerDocument;
  const el = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  container.replaceChildren();
  for (const error of state.errors) {
    const message = el(
      "p",
      `${error.line ? "Line " + error.line + ": " : ""}${error.message}`,
      "text-red-300 mb-3",
    );
    message.setAttribute("role", "alert");
    container.appendChild(message);
  }
  if (!state.entries.length) {
    container.appendChild(
      el(
        "p",
        state.status === "loading"
          ? "Loading cards…"
          : state.status === "dirty"
            ? "The list changed. Search again to refresh the cards."
            : "Enter a deck list to see your cards.",
        "text-content-light",
      ),
    );
    return;
  }
  const grid = el(
    "div",
    undefined,
    "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5",
  );
  container.appendChild(grid);
  for (const entry of state.entries) {
    const row = el("article", undefined, "paper-surface p-3 min-w-0");
    grid.appendChild(row);
    const printing = entry.printing;
    let imageFrame;
    if (printing) {
      const frame = el("div", undefined, "card-image-frame");
      imageFrame = frame;
      const status = el("div", undefined, "card-image-status");
      const image = el("img");
      image.alt = printing.name;
      image.decoding = "async";
      image.className = "w-full rounded-lg";
      image.addEventListener("imageloadstart", () => {
        image.hidden = true;
        status.hidden = false;
        status.replaceChildren(createLoadingIndicator(doc));
        frame.setAttribute("aria-busy", "true");
      });
      image.addEventListener("load", () => {
        image.hidden = false;
        status.hidden = true;
        frame.setAttribute("aria-busy", "false");
      });
      image.addEventListener("error", () => {
        image.hidden = true;
        status.hidden = false;
        status.textContent = "Preview could not load. Search again to reload this image.";
        frame.setAttribute("aria-busy", "false");
      });
      frame.append(image, status);
      row.appendChild(frame);
      setCardImage(image, printing.faces[0].url);
      if (printing.faces.length > 1) {
        let face = 0;
        row.appendChild(
          createButton(
            {
              text: "Flip card",
              size: "compact",
              ariaLabel: `Flip ${printing.name}`,
              onClick: () => {
                face = (face + 1) % printing.faces.length;
                setCardImage(image, printing.faces[face].url);
                image.alt = printing.faces[face].name || printing.name;
              },
            },
            doc,
          ),
        );
      }
    }
    row.appendChild(
      el(
        "h3",
        `${printing?.name || entry.name} ×${entry.qty}`,
        "font-semibold mt-3 break-words",
      ),
    );
    row.appendChild(
      el(
        "p",
        printing
          ? `${printing.setCode} ${printing.number}`
          : entry.status === "loading"
            ? "Loading image…"
            : entry.error,
        "text-sm text-content-light mt-1",
      ),
    );
    if (printing && printing.width && printing.width < 600)
      row.appendChild(
        el(
          "p",
          "Low-resolution source. Check print quality before making a full sheet.",
          "text-sm text-content-light mt-2",
        ),
      );
    if (printing?.rawCard && onPrintingExact) {
      const trigger = createButton(
        {
          id: `change-printing-${entry.id}`,
          size: "image",
          disabled: state.status !== "ready",
          ariaLabel: `Change printing for ${entry.name}`,
          onClick: () => {
            if (
              state.status !== "ready" ||
              !state.entries.includes(entry) ||
              entry.printing !== printing
            )
              return;
            const {
              openPrintingSelector,
            } = require("../../MagicTheGathering/printingSelector");
            openPrintingSelector({
              card: printing.rawCard,
              trigger,
              onApply: (raw) => {
                if (
                  state.status !== "ready" ||
                  !state.entries.includes(entry) ||
                  entry.printing !== printing
                )
                  return;
                onPrintingExact(entry, adapter.normalize(raw), printing);
                doc.getElementById(`change-printing-${entry.id}`)?.focus();
              },
            });
          },
        },
        doc,
      );
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-describedby", "printingHint");
      trigger.title = `Change printing for ${entry.name}`;
      trigger.appendChild(imageFrame);
      row.prepend(trigger);
    } else if (printing && adapter.printings) {
      const label = el("label", "Printing", "block text-sm mt-3");
      const select = el("select");
      select.className = "paper-input";
      select.setAttribute("aria-label", `Printing for ${entry.name}`);
      label.appendChild(select);
      row.appendChild(label);
      const option = el("option", `${printing.setCode} ${printing.number}`);
      option.value = printing.setCode.toLowerCase();
      select.appendChild(option);
      select.value = option.value;
      adapter
        .printings(printing)
        .then((options) => {
          if (!select.isConnected) return;
          select.replaceChildren();
          for (const item of options) {
            const o = el("option", item.label);
            o.value = item.setCode.toLowerCase();
            select.appendChild(o);
          }
          select.value = printing.setCode.toLowerCase();
        })
        .catch(() => {
          row.appendChild(
            el(
              "p",
              "Printings could not load. Search again to retry.",
              "text-sm text-red-300",
            ),
          );
        });
      select.addEventListener("change", () => onPrinting(entry, select.value));
      if (entry.changing)
        row.appendChild(el("p", "Loading printing…", "text-sm mt-2"));
      if (entry.printingError) {
        const error = el("p", entry.printingError, "text-sm text-red-300 mt-2");
        error.setAttribute("role", "alert");
        row.appendChild(error);
      }
    }
  }
  if (
    state.entries.some((e) => e.status === "error") &&
    state.status !== "loading"
  )
    container.appendChild(
      createButton(
        { text: "Retry failed cards", size: "compact", onClick: onRetry },
        doc,
      ),
    );
}
module.exports = { renderResults };
