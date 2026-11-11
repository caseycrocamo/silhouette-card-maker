"use strict";
function createStore(storage, game) {
  const selectionKey = `card-list:v1:${game}:selection`;
  const keyFor = (format = 'default') => `card-list:v1:${game}:${format}`;
  return {
    load(format) {
      let selection = {};
      try {
        selection = JSON.parse(storage.getItem(selectionKey)) || {};
      } catch {}
      const selectedFormat = format || selection.format || 'default';
      try {
        const saved = JSON.parse(storage.getItem(keyFor(selectedFormat)));
        if (saved && typeof saved.draft === "string") return { ...saved, format: selectedFormat };
      } catch {}
      // Keep drafts saved before storage was split by format.
      try {
        const legacy = JSON.parse(storage.getItem(`card-list:v1:${game}`));
        if (legacy && typeof legacy.draft === 'string' &&
            (selectedFormat === (legacy.format || 'default') || (!format && !selection.format)))
          return { ...legacy, format: legacy.format || selectedFormat };
      } catch {}
      let draft = game === "mtg" ? storage.getItem("mtg-decklist") || "" : "";
      if (game === "mtg" && !draft) {
        try {
          const legacy = JSON.parse(storage.getItem("mtg-cards"));
          if (Array.isArray(legacy))
            draft = legacy
              .filter(
                (card) =>
                  typeof card.name === "string" &&
                  Number.isSafeInteger(card.qty) &&
                  card.qty > 0,
              )
              .map(
                (card) =>
                  `${card.qty > 1 ? card.qty + "x " : ""}${card.name}${card.selectedSetCode ? " (" + card.selectedSetCode + ")" : ""}${card.selectedSetNumber ? " " + card.selectedSetNumber : ""}`,
              )
              .join("\n");
        } catch {}
      }
      return {
        draft,
        format: selectedFormat,
        workflow:
          game === "mtg" ? storage.getItem("cardWorkflow") : "front_only",
      };
    },
    save(draft, workflow, options = {}) {
      const format = options.format || this.load().format || 'default';
      const current = this.load(format);
      storage.setItem(keyFor(format), JSON.stringify({ ...current, ...options, format, draft, workflow }));
      storage.setItem(selectionKey, JSON.stringify({ format }));
      storage.setItem("activeGame", game);
    },
  };
}
module.exports = { createStore };
