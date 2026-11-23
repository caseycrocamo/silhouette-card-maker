"use strict";
const { createButton } = require("../button");
const { setCardImage } = require("../cardImages");
const { createLoadingIndicator } = require("../loadingIndicator");
const renderedResults = new WeakMap();
function renderResults(
  container,
  state,
  { adapter, onPrinting, onPrintingExact, onRetry, onQuantity, emptyMessage },
) {
  const doc = container.ownerDocument;
  const el = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  let view = renderedResults.get(container);
  if (!view || view.state !== state || view.adapter !== adapter || view.grid.parentNode !== container ||
      view.hasQuantity !== !!onQuantity || view.hasPrintingExact !== !!onPrintingExact || view.hasPrinting !== !!onPrinting) {
    container.replaceChildren();
    view = {state,adapter,rows:new Map(),messages:el("div"),footer:el("div"),
      grid:el("div",undefined,"grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"),
      hasQuantity:!!onQuantity,hasPrintingExact:!!onPrintingExact,hasPrinting:!!onPrinting};
    container.append(view.messages,view.grid,view.footer);
    renderedResults.set(container,view);
  }
  view.messages.replaceChildren();
  view.footer.replaceChildren();
  const grid = view.grid, rows = view.rows;
  const ids = new Set(state.entries.map(entry=>entry.id));
  for (const [id, old] of rows) {
    if (!ids.has(id)) { old.row.remove(); rows.delete(id); }
  }
  for (const error of state.errors) {
    const message = el(
      "p",
      `${error.line ? "Line " + error.line + ": " : ""}${error.message}`,
      "text-red-300 mb-3",
    );
    message.setAttribute("role", "alert");
    view.messages.appendChild(message);
  }
  if (!state.entries.length) {
    view.messages.appendChild(
      el(
        "p",
        state.status === "loading"
          ? "Loading cards…"
          : state.status === "dirty"
            ? "The list changed. Search again to refresh the cards."
            : emptyMessage || "Enter a deck list to see your cards.",
        "text-content-light",
      ),
    );
    return;
  }
  for (const [index, entry] of state.entries.entries()) {
    const old = rows.get(entry.id);
    if (old && old.entry === entry && old.printing === entry.printing && old.status === entry.status &&
        old.error === entry.error && old.changing === entry.changing && old.printingError === entry.printingError) {
      old.title.textContent = `${entry.printing?.name || entry.name} ×${entry.qty}`;
      const editable = ["ready","partial","error"].includes(state.status);
      if (old.add) old.add.disabled = !editable || !Number.isSafeInteger(entry.qty+1);
      if (old.remove) old.remove.disabled = !editable;
      if (old.trigger) old.trigger.disabled = state.status !== "ready";
      const position = grid.children[index];
      if (position !== old.row) grid.insertBefore(old.row,position || null);
      continue;
    }
    old?.row.remove();
    const row = el("article", undefined, "paper-surface p-3 min-w-0");
    row.dataset.entryId = entry.id;
    grid.insertBefore(row,grid.children[index] || null);
    const printing = entry.printing;
    const record = { row, entry, printing, status: entry.status, error: entry.error,
      changing: entry.changing, printingError: entry.printingError };
    rows.set(entry.id, record);
    let imageFrame, preview;
    if (printing) {
      preview = el("div", undefined, "card-image-preview");
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
      preview.appendChild(frame);
      row.appendChild(preview);
      setCardImage(image, printing.faces[0].url);
      if (printing.faces.length > 1) {
        let face = 0;
        const flip = createButton(
            {
              text: "Flip card",
              size: "compact",
              ariaLabel: `Flip ${printing.name}`,
              onClick: event => {
                event.preventDefault();
                event.stopPropagation();
                face = (face + 1) % printing.faces.length;
                setCardImage(image, printing.faces[face].url);
                image.alt = printing.faces[face].name || printing.name;
                flip.setAttribute("aria-pressed", String(face !== 0));
              },
            },
            doc,
          );
        flip.classList.add("card-image-flip");
        flip.setAttribute("aria-pressed", "false");
        preview.appendChild(flip);
      }
    }
    record.title = el(
        "h3",
        `${printing?.name || entry.name} ×${entry.qty}`,
        "font-semibold mt-3 break-words",
      );
    row.appendChild(record.title);
    if (onQuantity) {
      const controls = el("div", undefined, "flex items-center gap-2 mt-3");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", `Copies of ${entry.name}`);
      for (const [delta, text, verb] of [[-1, "−", "Remove"], [1, "+", "Add"]]) {
        const button = createButton({
          id: `quantity-${delta === 1 ? "add" : "remove"}-${entry.id}`,
          text, size: "icon", ariaLabel: `${verb} one copy of ${entry.name}`,
          disabled: !["ready", "partial", "error"].includes(state.status) || (delta === 1 && !Number.isSafeInteger(entry.qty + 1)),
          onClick: () => onQuantity(entry, delta),
        }, doc);
        if (delta === 1) record.add = button; else record.remove = button;
        controls.appendChild(button);
      }
      row.appendChild(controls);
    }
    row.appendChild(
      el(
        "p",
        printing
          ? [printing.setCode, printing.number].filter(Boolean).join(" ") || "Image ready"
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
    if (printing?.custom) row.appendChild(el("p", "Custom image — printing selection unavailable", "text-sm text-content-light mt-2"));
    if (entry.token) row.appendChild(el("p", "Related token", "text-sm text-content-light mt-2"));
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
      record.trigger = trigger;
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-describedby", "printingHint");
      trigger.title = `Change printing for ${entry.name}`;
      trigger.appendChild(imageFrame);
      preview.prepend(trigger);
    } else if (printing && !printing.custom && adapter.printings) {
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
  for (const warning of state.warnings || []) {
    const message = el("p", warning.message || String(warning), "text-sm text-content-light mt-2");
    message.setAttribute("role", "status");
    view.footer.appendChild(message);
  }
  if (
    state.entries.some((e) => e.status === "error") &&
    state.status !== "loading"
  )
    view.footer.appendChild(
      createButton(
        { text: "Retry failed cards", size: "compact", onClick: onRetry },
        doc,
      ),
    );
  else if (state.errors.length && adapter.reimportOnRetry && state.status !== "loading")
    view.footer.appendChild(
      createButton({ text: "Retry import", size: "compact", onClick: onRetry }, doc),
    );

}
module.exports = { renderResults };
