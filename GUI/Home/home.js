"use strict";
(() => {
  const { ipcRenderer, shell } = require("electron");
  const { games } = require("../shared/cardList/gameRegistry");
  const { createButton } = require("../shared/button");
  const { chooseGameOptions, saveGameOptions } = require("../shared/gameOptions");

  window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.invoke("offset-data-exists").then(exists => {
      if (!exists) document.getElementById("calibrationNotice").classList.remove("hidden");
    }).catch(error => { document.getElementById("gamePickerError").textContent = error.message; });
    document.getElementById("calibrationDocsLink").onclick = event => {
      event.preventDefault();
      shell.openExternal("https://alan-cha.github.io/silhouette-card-maker/docs/offset/");
    };
    const picker = document.getElementById("gamePicker");
    for (const game of Object.values(games)) {
      const button = createButton({ text: game.name, onClick: async () => {
        const choice = await chooseGameOptions({ game, storage: sessionStorage,
          trigger: button,
          chooseDirectory: () => ipcRenderer.invoke("select-card-input", { kind: "directory" }),
        });
        if (!choice) return;
        saveGameOptions(sessionStorage, game, choice);
        location.href = choice.mode === "translation" ? "../MagicTheGathering/text_translation.html" :
          `../CardList/decklist.html?game=${encodeURIComponent(game.id)}`;
      } }, document);
      button.dataset.game = game.id;
      button.classList.add("min-h-16");
      picker.append(button);
    }
  });
})();
