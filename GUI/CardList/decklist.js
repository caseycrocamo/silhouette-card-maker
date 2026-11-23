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
  let requestSequence = 0;
  const request = (payload, onProgress) => {
    if (!onProgress) return ipcRenderer.invoke("card-request", payload);
    const progressId = `${Date.now()}-${++requestSequence}`;
    const listener = (_event, message) => { if (message.progressId === progressId) onProgress(message.progress); };
    ipcRenderer.on("card-progress", listener);
    return ipcRenderer.invoke("card-request", {...payload,progressId}).finally(() => ipcRenderer.removeListener("card-progress", listener));
  };
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
  let mtgPreferences = saved.mtgPreferences || {};
  let urlEdits = saved.urlEdits || {};
  let urlDeckLoaded = saved.urlDeckLoaded === true;
  let urlSource = saved.urlSource || "";
  let urlOriginalDraft = saved.urlOriginalDraft || "";
  let urlDeckPending = saved.urlDeckPending === true;
  const defaultUrlSelection = () => ({include_maybeboard:false,include_sideboard:false,tokens:false});
  let urlFetchSelection = {...defaultUrlSelection(), ...saved.urlFetchSelection};
  const save = draft => store.save(draft, options.workflow, {...options, mtgPreferences, urlEdits, urlDeckLoaded, urlSource, urlOriginalDraft, urlDeckPending, urlFetchSelection});
  const adapter = game.id === "mtg" ? require("./adapters/mtgImport").createImportAdapter(request,
    () => isUrlFormat() ? {...mtgPreferences,...urlFetchSelection} : mtgPreferences,
    value => urlEdits.url === value.trim() ? urlEdits.quantities || {} : {}, ({url,text}) => {
      urlSource = url.trim();
      urlDeckLoaded = true;
      urlDeckPending = true;
      urlOriginalDraft = text;
      mtgPreferences = {...mtgPreferences,tokens:urlFetchSelection.tokens};
      renderPreferences();
      setAdapterFormat();
      renderOptions();
      controller.replaceDraft(text);
    }) :
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

  function setAdapterFormat() {
    adapter.setFormat?.(game.id === "mtg" && options.format === "url" && urlDeckLoaded ? "default" : options.format);
  }
  setAdapterFormat();
  let preferencesHost;
  function renderPreferences() {
    if (!preferencesHost) return;
    preferencesHost.replaceChildren();
    require("../shared/cardList/mtgPreferences").mountPreferences(preferencesHost, mtgPreferences, value => {
      mtgPreferences=value; controller.stale(); save(get("longText").value);
    });
  }
  if (game.id === "mtg") {
    preferencesHost=document.createElement("div"); get("longForm").append(preferencesHost);
    renderPreferences();
  }
  const openFile=require("../shared/button").createButton({text:"Open deck file"});
  get("longForm").append(openFile);
  const resetUrlEdits = require("../shared/button").createButton({
    id: "resetUrlEditsBtn", text: "Reset card changes", size: "compact", onClick: () => {
      urlEdits = {};
      const url = urlSource || get("longText").value;
      urlDeckLoaded = false;
      urlDeckPending = false;
      urlOriginalDraft = "";
      setAdapterFormat();
      renderOptions();
      controller.dirty(url);
      controller.search(url);
    },
  });
  resetUrlEdits.hidden = true;
  get("longForm").append(resetUrlEdits);
  const changeUrl = require("../shared/button").createButton({
    id: "changeUrlBtn", text: "Load another URL", size: "compact", onClick: () => {
      urlDeckLoaded = false;
      urlDeckPending = false;
      urlEdits = {};
      urlOriginalDraft = "";
      urlFetchSelection = defaultUrlSelection();
      setAdapterFormat();
      renderOptions();
      controller.dirty("");
      get("longText").focus();
    },
  });
  changeUrl.hidden = true;
  get("longForm").append(changeUrl);
  const editor = get("longForm").closest(".card-list-editor");
  let editorSizeFrame = 0;
  function queueEditorSize() {
    if (editorSizeFrame) return;
    editorSizeFrame = requestAnimationFrame(() => {
      editorSizeFrame = 0;
      const input = get("longText");
      const results = get("resultsSection");
      if (innerWidth < 1024 || isUrlFormat() || results.hidden ||
          !get("output").querySelector("article") || !editor.getClientRects().length) {
        input.style.height = "";
        editor.style.maxHeight = "";
        editor.style.overflowY = "";
        return;
      }
      const frame = editor.offsetHeight - editor.clientHeight;
      const chrome = Math.max(editor.offsetHeight, editor.scrollHeight + frame) - input.offsetHeight;
      const style = getComputedStyle(input);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const minimum = parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + border;
      const available = Math.max(minimum, results.offsetHeight - chrome);
      input.style.height = "0px";
      input.style.height = `${Math.min(input.scrollHeight + border, available)}px`;
      editor.style.maxHeight = `${results.offsetHeight}px`;
      editor.style.overflowY = "auto";
    });
  }
  const editorSizeObserver = new ResizeObserver(queueEditorSize);
  editorSizeObserver.observe(editor);
  editorSizeObserver.observe(get("resultsSection"));
  window.addEventListener("resize", queueEditorSize);
  openFile.onclick=async()=>{
    if (exporting || controller.state.status === 'loading') return;
    try {
      const selected=await ipcRenderer.invoke("select-card-input",{kind:"file"});
      if(!selected)return;
      get('exportError').textContent = '';
      adapter.clearSource?.(); adapter.setInput?.({kind:"file",value:selected.path});
      controller.dirty(game.id === "mtg" ? selected.text : selected.path);
      await controller.search(game.id === "mtg" ? selected.text : selected.path);
    } catch (error) { get('exportError').textContent = error.message || String(error); }
  };
  function isUrlFormat() {
    return game.id === "mtg" && game.formats.find(item => item.id === options.format)?.inputKind === "url" && !urlDeckLoaded;
  }
  function isImportedUrlDeck() {
    return game.id === "mtg" && options.format === "url" && urlDeckLoaded;
  }
  function renderUrlState(state) {
    const urlMode = isUrlFormat();
    const fetched = state.entries.some(entry => entry.status === "ready");
    const showResults = !urlMode || fetched || state.status === "loading" || state.status === "error";
    get("resultsSection").hidden = !showResults;
    get("workflowSection").hidden = urlMode && !fetched && !get("exportError").textContent;
    get("exportBtn").hidden = urlMode && state.status !== "ready";
    get("printingHint").hidden = game.id !== "mtg" || (urlMode && !fetched);
    get("gameOptionsSummary").hidden = urlMode && !fetched;
    if (preferencesHost) preferencesHost.hidden = urlMode && !fetched;
    const legacyEdits = urlEdits.url === (urlSource || state.draft).trim() && Object.keys(urlEdits.quantities || {}).length;
    resetUrlEdits.hidden = isImportedUrlDeck() ? state.draft === urlOriginalDraft && !legacyEdits : !urlMode || !legacyEdits;
    resetUrlEdits.disabled = state.status === "loading" || exporting;
    changeUrl.hidden = !isImportedUrlDeck();
    changeUrl.disabled = state.status === "loading" || exporting;
    get("urlFetchOptions").hidden = !urlMode;
    get("urlFetchOptions").disabled = state.status === "loading" || exporting;
    get("cardWorkspace").dataset.urlIntro = String(urlMode && !showResults);
    queueEditorSize();
  }
  function renderOptions() {
    get("gameOptionsSummary").textContent = optionsSummary(game, options);
    get("gameOptionsBtn").hidden = !hasGameOptions(game);
    const format = game.formats.find(item => item.id === options.format);
    const urlMode = isUrlFormat();
    get("urlIncludeMaybeboard").checked = urlFetchSelection.include_maybeboard;
    get("urlIncludeSideboard").checked = urlFetchSelection.include_sideboard;
    get("urlIncludeTokens").checked = urlFetchSelection.tokens;
    const help = { url: "Enter a deck URL or ID for this format.", file: "Select Open deck file, or paste the source document below.", opaque: "Paste your deck code." };
    get("syntaxHelp").textContent = isImportedUrlDeck() ? game.help : help[format?.inputKind] || game.help;
    get("longText").readOnly = format?.inputKind === "file" && game.id !== "mtg";
    openFile.hidden = format?.inputKind !== "file";
    get("longText").placeholder = game.example || "";
    get("inputLabel").textContent = urlMode ? "URL" : "Deck list";
    get("pageIntro").textContent = urlMode ? "Enter a deck URL to fetch its cards." : "Paste a deck list. Review each card before you create the PDF.";
    get("longText").rows = urlMode ? 2 : 12;
    get("longText").required = urlMode;
    get("longText").setAttribute("inputmode", urlMode ? "url" : "text");
    get("longText").setCustomValidity("");
    if (urlMode) {
      get("longText").placeholder = "https://…";
      get("syntaxHelp").textContent = "Paste the full link to a supported deck page.";
    }
    get("searchBtn").textContent = urlMode ? "Fetch cards" : format?.inputKind === "file" && game.id !== "mtg" ? "Open deck file" : "Search cards";
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
      if (ready && isImportedUrlDeck() && urlDeckPending) {
        urlDeckPending = false;
        urlOriginalDraft = state.draft;
        save(state.draft);
      }
      get("nextCreatePdfBtn").disabled = !ready || exporting;
      get("exportBtn").disabled = !ready || exporting;
      get("searchBtn").disabled = state.status === "loading" || exporting || (isUrlFormat() && !state.draft.trim());
      get("gameOptionsBtn").disabled = state.status === "loading" || exporting;
      openFile.disabled = state.status === "loading" || exporting;
      const entries = state.entries.filter(item => item.status === "ready");
      const copies = entries.reduce((count, item) => count + item.qty, 0);
      renderUrlState(state);
      get("resultStatus").textContent = state.status === "loading" ?
        (state.progress ? `Loading cards: ${entries.length} of ${state.progress.total} entries ready` :
          !state.entries.length ? (isUrlFormat() ? "Fetching deck…" : "Loading cards…") : `Loading cards: ${entries.length} of ${state.entries.length} entries ready`) :
        `${entries.length} unique cards · ${copies} total cards${state.status === "dirty" ? " · Search again after edits" : ""}`;
      const displayState = isUrlFormat() && state.status === "loading"
        ? { ...state, entries: state.entries.filter(entry => entry.status !== "loading") } : state;
      renderResults(get("output"), displayState, { adapter,
        onQuantity: game.id === "mtg" && options.format === "url" ? (entry, delta) => {
          const index = controller.state.entries.indexOf(entry);
          const quantity = entry.qty + delta;
          if (!controller.changeQuantity(entry, delta)) return;
          if (!urlDeckLoaded) {
            const url = get("longText").value.trim();
            if (urlEdits.url !== url) urlEdits = { url, quantities: {} };
            urlEdits.quantities[entry.sourceKey] = quantity;
          }
          save(get("longText").value);
          renderUrlState(controller.state);
          const next = controller.state.entries.includes(entry) ? entry : controller.state.entries[index] || controller.state.entries[index - 1];
          (next ? get(`quantity-${delta === 1 ? "add" : "remove"}-${next.id}`) : resetUrlEdits)?.focus();
        } : undefined,
        emptyMessage: isUrlFormat() ? "Check the URL, then fetch the cards again." : undefined,
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
    mtgPreferences = nextSaved.mtgPreferences || mtgPreferences;
    urlEdits = nextSaved.urlEdits || {};
    urlDeckLoaded = nextSaved.urlDeckLoaded === true;
    urlSource = nextSaved.urlSource || "";
    urlOriginalDraft = nextSaved.urlOriginalDraft || "";
    urlDeckPending = nextSaved.urlDeckPending === true;
    urlFetchSelection = {...defaultUrlSelection(),...nextSaved.urlFetchSelection};
    renderPreferences();
    setAdapterFormat();
    renderOptions();
    if (lookupChanged) controller.dirty(nextSaved.draft);
    else save(controller.state.draft);
    renderUrlState(controller.state);
  };
  get("longText").addEventListener("input", () => {
    urlDeckPending = false;
    get("longText").setCustomValidity("");
    closePrintingSelector();
    if(game.id === "mtg") adapter.clearSource?.();
    controller.dirty(get("longText").value);
  });
  for (const [id,key] of [["urlIncludeMaybeboard","include_maybeboard"],["urlIncludeSideboard","include_sideboard"],["urlIncludeTokens","tokens"]]) {
    get(id).addEventListener("change", () => {
      urlFetchSelection[key] = get(id).checked;
      save(get("longText").value);
    });
  }
  get("longForm").addEventListener("submit", event => {
    event.preventDefault();
    if (isUrlFormat()) {
      try {
        const url = new URL(get("longText").value.trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        get("longText").setCustomValidity("Enter a full HTTP or HTTPS deck URL.");
        get("longText").reportValidity();
        return;
      }
    }
    closePrintingSelector(); controller.search(get("longText").value);
  });
  get("exportBtn").addEventListener("click", () => {
    if (!controller.canExport()) return;
    const text = adapter.exportText ? adapter.exportText(controller.state.entries) : adapter.serialize(controller.state.entries);
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = `${game.id}-decklist.txt`; link.click();
    URL.revokeObjectURL(url);
  });
  get("nextCreatePdfBtn").addEventListener("click", async () => {
    if (!controller.canExport() || exporting) return;
    exporting = true;
    const formControls = [...get('longForm').querySelectorAll('button,input,select,textarea')]
      .map(control => ({ control, disabled: control.disabled }));
    formControls.forEach(({ control }) => { control.disabled = true; });
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
      formControls.forEach(({ control, disabled }) => { control.disabled = disabled; });
      for (const control of get("output").querySelectorAll("select,button")) control.disabled = false;
      exporting = false;
      get("longText").disabled = false; get("searchBtn").disabled = false; get("gameOptionsBtn").disabled = false;
      get("exportBtn").disabled = !controller.canExport(); get("nextCreatePdfBtn").disabled = !controller.canExport();
      window.hideLoadingOverlay?.();
    }
  });
  window.addEventListener("beforeunload", () => {
    closePrintingSelector(); controller.cancel();
    editorSizeObserver.disconnect();
    window.removeEventListener("resize", queueEditorSize);
    cancelAnimationFrame(editorSizeFrame);
  });
  controller.dirty(saved.draft);
  if (saved.draft.trim() && game.formats.find(item => item.id === options.format)?.inputKind !== "file") controller.search(saved.draft);
})();
