"use strict";
(async () => {
  const { ipcRenderer } = require("electron");
  const { getGame } = require("../shared/cardList/gameRegistry");
  const { createStore } = require("../shared/cardList/sessionStore");
  const { createController } = require("../shared/cardList/controller");
  const { renderResults } = require("../shared/cardList/resultsGrid");
  const { closePrintingSelector } = require("../MagicTheGathering/printingSelector");
  const { loadGameOptions, normalizeOptions, chooseGameOptions, saveGameOptions, optionsSummary, hasGameOptions } = require("../shared/gameOptions");
  const get = id => document.getElementById(id);
  const request = payload => ipcRenderer.invoke("card-request", payload);
  let game;
  get("longText").disabled = true;
  get("searchBtn").disabled = true;
  try {
    game = getGame(new URLSearchParams(location.search).get("game") || sessionStorage.getItem("activeGame") || "mtg");
    get("gameTitle").textContent = `${game.name} card list`;
    document.title = `${game.name} - Card List`;
    get("gameOptionsSummary").textContent = "Loading game options…";
    game = loadGameOptions(game);
  } catch (error) {
    get("exportError").textContent = error.message;
    get("gameOptionsSummary").textContent = "Game options could not load.";
    get("gameOptionsBtn").hidden = false;
    get("gameOptionsBtn").textContent = "Retry";
    get("gameOptionsBtn").onclick = () => location.reload();
    return;
  }
  sessionStorage.setItem("activeGame", game.id);
  const store = createStore(sessionStorage, game.id);
  let options = normalizeOptions(game, store.load());
  const saved = store.load(options.format);
  options = normalizeOptions(game, saved, options.format);
  let exporting = false;
  const save = draft => store.save(draft, options.workflow, options);
  const adapter = game.id === "mtg" ? require("./adapters/mtg").createAdapter() :
    game.id === "pokemon" ? require("./adapters/pokemon").createAdapter(request) :
      require("./adapters/plugin").createAdapter(game, request, {
        format: options.format,
        input: async (value, kind) => {
          if (kind !== "file") return { kind, value };
          const selected = await ipcRenderer.invoke("select-card-input", { kind: "file" });
          if (!selected) throw new Error("Import canceled.");
          return { kind, value: selected.path };
        },
        readOptions: () => ({ source: options.source, scenario: options.scenario, localBackDir: options.localBackDir }),
      });

  function renderOptions() {
    get("gameOptionsSummary").textContent = optionsSummary(game, options);
    get("gameOptionsBtn").hidden = !hasGameOptions(game);
    const format = game.formats.find(item => item.id === options.format);
    const help = { url: "Enter a deck URL or ID for this format.", file: "Select Open deck file to choose your deck list.", opaque: "Paste your deck code." };
    get("syntaxHelp").textContent = help[format?.inputKind] || game.help;
    get("longText").readOnly = format?.inputKind === "file";
    get("longText").placeholder = game.example || "";
    get("searchBtn").textContent = format?.inputKind === "file" ? "Open deck file" : "Search cards";
  }
  get("printingHint").hidden = game.id !== "mtg";
  renderOptions();
  get("longText").value = saved.draft;
  get("longText").disabled = false;
  const controller = createController({
    adapter,
    onDraft: draft => { get("longText").value = draft; save(draft); },
    onChange: state => {
      const ready = controller.canExport();
      get("nextCreatePdfBtn").disabled = !ready || exporting;
      get("exportBtn").disabled = !ready || exporting;
      get("searchBtn").disabled = state.status === "loading" || exporting;
      get("gameOptionsBtn").disabled = state.status === "loading" || exporting;
      const entries = state.entries.filter(item => item.status === "ready");
      const copies = entries.reduce((count, item) => count + item.qty, 0);
      get("resultStatus").textContent = state.status === "loading" ?
        `Loading cards: ${entries.length} of ${state.entries.length} entries ready` :
        `${entries.length} entries ready · ${copies} cards${state.status === "dirty" ? " · Search again after edits" : ""}`;
      renderResults(get("output"), state, { adapter,
        onPrinting: controller.changePrinting, onPrintingExact: controller.applyPrinting,
        onRetry: () => controller.search(state.draft, true),
      });
    },
  });
  get("gameOptionsBtn").onclick = async () => {
    closePrintingSelector();
    const choice = await chooseGameOptions({ game, storage: sessionStorage,
      trigger: get("gameOptionsBtn"), alwaysShow: true, mode: "cards",
      chooseDirectory: () => ipcRenderer.invoke("select-card-input", { kind: "directory" }),
    });
    if (!choice) return;
    const next = normalizeOptions(choice.game, choice);
    const lookupChanged = ["format", "source", "scenario", "localBackDir"].some(key => next[key] !== options[key]);
    const nextSaved = saveGameOptions(sessionStorage, game, choice);
    if (choice.mode === "translation") { location.href = "../MagicTheGathering/text_translation.html"; return; }
    game = choice.game;
    options = next;
    adapter.setFormat?.(options.format);
    renderOptions();
    if (lookupChanged) controller.dirty(nextSaved.draft);
    else save(controller.state.draft);
  };
  get("longText").addEventListener("input", () => {
    closePrintingSelector();
    controller.dirty(get("longText").value);
  });
  get("longForm").addEventListener("submit", event => {
    event.preventDefault(); closePrintingSelector(); controller.search(get("longText").value);
  });
  get("exportBtn").addEventListener("click", () => {
    if (!controller.canExport()) return;
    const url = URL.createObjectURL(new Blob([adapter.serialize(controller.state.entries)], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = `${game.id}-decklist.txt`; link.click();
    URL.revokeObjectURL(url);
  });
  get("nextCreatePdfBtn").addEventListener("click", async () => {
    if (!controller.canExport() || exporting) return;
    exporting = true;
    for (const id of ["longText", "nextCreatePdfBtn", "searchBtn", "exportBtn", "gameOptionsBtn"]) get(id).disabled = true;
    get("exportError").textContent = "";
    for (const control of get("output").querySelectorAll("select,button")) control.disabled = true;
    window.showLoadingOverlay?.({ title: "Preparing cards", message: "Checking and saving card images…" });
    try {
      const result = await ipcRenderer.invoke("card-export", { plan: adapter.exportPlan(controller.state.entries, options.workflow) });
      if (result?.canceled || result?.cancelled) return;
      sessionStorage.setItem("onlyFronts", String(options.workflow === "front_only"));
      save(get("longText").value);
      location.href = "../CreatePDF/create.html";
    } catch (error) {
      get("exportError").textContent = error.message || String(error); get("exportError").focus();
    } finally {
      for (const control of get("output").querySelectorAll("select,button")) control.disabled = false;
      exporting = false;
      get("longText").disabled = false; get("searchBtn").disabled = false; get("gameOptionsBtn").disabled = false;
      get("exportBtn").disabled = !controller.canExport(); get("nextCreatePdfBtn").disabled = !controller.canExport();
      window.hideLoadingOverlay?.();
    }
  });
  window.addEventListener("beforeunload", () => { closePrintingSelector(); controller.cancel(); });
  controller.dirty(saved.draft);
  if (saved.draft.trim() && game.formats.find(item => item.id === options.format)?.inputKind !== "file") controller.search(saved.draft);
})();
