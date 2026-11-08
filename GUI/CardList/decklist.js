"use strict";
(() => {
  const { ipcRenderer } = require("electron");
  const { getGame } = require("../shared/cardList/gameRegistry");
  const { createStore } = require("../shared/cardList/sessionStore");
  const { createController } = require("../shared/cardList/controller");
  const { renderResults } = require("../shared/cardList/resultsGrid");
  const {
    closePrintingSelector,
  } = require("../MagicTheGathering/printingSelector");
  const get = (id) => document.getElementById(id);
  let game;
  try {
    game = getGame(
      new URLSearchParams(location.search).get("game") ||
        sessionStorage.getItem("activeGame") ||
        "mtg",
    );
  } catch (error) {
    get("gameTitle").textContent = error.message;
    return;
  }
  sessionStorage.setItem("activeGame", game.id);
  const adapter =
    game.id === "mtg"
      ? require("./adapters/mtg").createAdapter()
      : require("./adapters/pokemon").createAdapter((req) =>
          ipcRenderer.invoke("card-request", req),
        );
  const store = createStore(sessionStorage, game.id),
    saved = store.load();
  let workflow = game.workflows.includes(saved.workflow)
    ? saved.workflow
    : game.defaultWorkflow;
  let exporting = false;
  const save = (draft) => store.save(draft, workflow);
  get("gameTitle").textContent = `${game.name} card list`;
  document.title = `${game.name} - Card List`;
  get("printingHint").hidden = game.id !== "mtg";
  get("syntaxHelp").textContent = game.help;
  get("longText").placeholder = game.example;
  get("longText").value = saved.draft;
  if (game.workflows.length === 1) get("workflow").textContent = "Fronts only";
  else
    for (const mode of game.workflows) {
      const label = document.createElement("label");
      label.className = "inline-flex items-center gap-2 mr-6";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "cardWorkflow";
      radio.value = mode;
      radio.checked = workflow === mode;
      radio.addEventListener("change", () => {
        workflow = mode;
        save(get("longText").value);
      });
      label.append(
        radio,
        document.createTextNode(
          mode === "front_only" ? "Front Only" : "Double Sided",
        ),
      );
      get("workflow").appendChild(label);
    }
  get("workflowHelp").textContent =
    game.id === "mtg"
      ? "Front Only prints both faces separately. Double Sided pairs the fronts and backs of double-faced cards."
      : "Use the PDF page to change page size, cut guides, and other print settings. A common back can be enabled there.";
  const controller = createController({
    adapter,
    onDraft: (draft) => {
      get("longText").value = draft;
      save(draft);
    },
    onChange: (state) => {
      const ready = controller.canExport();
      get("nextCreatePdfBtn").disabled = !ready || exporting;
      get("exportBtn").disabled = !ready || exporting;
      get("searchBtn").disabled = state.status === "loading" || exporting;
      const count = state.entries.filter((e) => e.status === "ready").length;
      const copies = state.entries
        .filter((e) => e.status === "ready")
        .reduce((n, e) => n + e.qty, 0);
      get("resultStatus").textContent =
        state.status === "loading"
          ? `Loading cards: ${count} of ${state.entries.length} entries ready`
          : `${count} entries ready · ${copies} cards${state.status === "dirty" ? " · Search again after edits" : ""}`;
      renderResults(get("output"), state, {
        adapter,
        onPrinting: controller.changePrinting,
        onPrintingExact: controller.applyPrinting,
        onRetry: () => controller.search(state.draft, true),
      });
    },
  });
  get("longText").addEventListener("input", () => {
    closePrintingSelector();
    controller.dirty(get("longText").value);
  });
  get("longForm").addEventListener("submit", (event) => {
    event.preventDefault();
    closePrintingSelector();
    controller.search(get("longText").value);
  });
  get("exportBtn").addEventListener("click", () => {
    if (!controller.canExport()) return;
    const url = URL.createObjectURL(
      new Blob([adapter.serialize(controller.state.entries)], {
        type: "text/plain",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${game.id}-decklist.txt`;
    link.click();
    URL.revokeObjectURL(url);
  });
  get("nextCreatePdfBtn").addEventListener("click", async () => {
    if (!controller.canExport() || exporting) return;
    exporting = true;
    get("longText").disabled = true;
    get("nextCreatePdfBtn").disabled = true;
    get("searchBtn").disabled = true;
    get("exportBtn").disabled = true;
    get("exportError").textContent = "";
    for (const control of get("output").querySelectorAll("select,button"))
      control.disabled = true;
    for (const control of get("workflow").querySelectorAll("input"))
      control.disabled = true;
    window.showLoadingOverlay?.({
      title: "Preparing Cards",
      message: "Checking and saving card images…",
    });
    try {
      const result = await ipcRenderer.invoke("card-export", {
        plan: adapter.exportPlan(controller.state.entries, workflow),
      });
      if (result?.canceled || result?.cancelled) return;
      sessionStorage.setItem("onlyFronts", String(workflow === "front_only"));
      save(get("longText").value);
      location.href = "../CreatePDF/create.html";
    } catch (error) {
      get("exportError").textContent = error.message || String(error);
      get("exportError").focus();
    } finally {
      for (const control of get("output").querySelectorAll("select,button"))
        control.disabled = false;
      for (const control of get("workflow").querySelectorAll("input"))
        control.disabled = false;
      exporting = false;
      get("longText").disabled = false;
      get("searchBtn").disabled = false;
      get("exportBtn").disabled = !controller.canExport();
      get("nextCreatePdfBtn").disabled = !controller.canExport();
      window.hideLoadingOverlay?.();
    }
  });
  window.addEventListener("beforeunload", () => {
    closePrintingSelector();
    controller.cancel();
  });
  controller.dirty(saved.draft);
  if (saved.draft.trim()) controller.search(saved.draft);
})();
