"use strict";
function createStore(storage, game) {
  const key = `card-list:v1:${game}`;
  return {
    load() {
      try {
        const saved = JSON.parse(storage.getItem(key));
        if (saved && typeof saved.draft === "string")
          return { draft: saved.draft, workflow: saved.workflow };
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
        workflow:
          game === "mtg" ? storage.getItem("cardWorkflow") : "front_only",
      };
    },
    save(draft, workflow) {
      storage.setItem(key, JSON.stringify({ draft, workflow }));
      storage.setItem("activeGame", game);
    },
  };
}
module.exports = { createStore };
