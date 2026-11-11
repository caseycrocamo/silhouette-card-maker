"use strict";

const { createButton } = require("./button");
const { createStore } = require("./cardList/sessionStore");
const gameCatalog = require("./gameCatalog.json");

function loadGameOptions(game) {
  if (["mtg", "pokemon"].includes(game.id)) {
    return {
      ...game,
      formats: game.id === "pokemon" ? [{ id: "default", label: "Limitless", inputKind: "text" }] : [
        { id: "default", label: "Card names and printings", inputKind: "text" },
        ...["simple", "mtga", "mtgo", "archidekt", "deckstats", "moxfield", "cubecobra_csv", "scryfall_json", "mpcfill_xml", "url"].map(id => ({ id, label: id.replace(/_/g, " ").toUpperCase(), inputKind: id === "url" ? "url" : ["cubecobra_csv", "scryfall_json", "mpcfill_xml"].includes(id) ? "file" : "text" })),
      ],
      sourceChoices: [], scenarioChoices: [],
    };
  }
  const descriptor = gameCatalog.games.find(item => item.id === game.id);
  if (!descriptor) throw new Error("Game options could not load. Try again.");
  return { ...game, ...descriptor, name: game.name };
}

function normalizeOptions(game, saved = {}, format) {
  const chosenFormat = game.formats.find(item => item.id === (format || saved.format)) || game.formats[0];
  return {
    format: chosenFormat.id,
    source: game.sourceChoices?.some(item => item.id === saved.source) ? saved.source : game.sourceChoices?.[0]?.id || "",
    scenario: game.scenarioChoices?.some(item => item.id === saved.scenario) ? saved.scenario : game.scenarioChoices?.[0]?.id || "",
    workflow: game.workflows.includes(saved.workflow) ? saved.workflow :
      game.workflows.includes(game.defaultWorkflow) ? game.defaultWorkflow : game.workflows[0],
    localBackDir: saved.localBackDir || "",
  };
}

function hasGameOptions(game) {
  return game.id === "mtg" || game.formats.length > 1 || game.sourceChoices?.length > 1 ||
    game.scenarioChoices?.length > 1 || game.workflows.length > 1 || game.id === "lotr_lcg";
}

function saveGameOptions(storage, game, options) {
  const store = createStore(storage, game.id);
  const draft = store.load(options.format).draft;
  store.save(draft, options.workflow, {
    format: options.format, source: options.source, scenario: options.scenario, localBackDir: options.localBackDir,
  });
  storage.setItem(`game-mode:${game.id}`, options.mode || "cards");
  return store.load(options.format);
}

function optionsSummary(game, options) {
  const labels = [];
  for (const [items, value] of [[game.formats, options.format], [game.sourceChoices, options.source], [game.scenarioChoices, options.scenario]]) {
    const label = items?.find(item => item.id === value)?.label;
    if (label) labels.push(label);
  }
  if (game.workflows.length > 1) labels.push(options.workflow === "double_sided" ? "Paired fronts and backs" : game.id === "mtg" ? "Faces printed separately" : "Fronts only");
  return labels.join(" · ");
}

// A native dialog supplies focus trapping, Escape, and an inert background.
function chooseGameOptions({ game, storage, trigger, chooseDirectory, alwaysShow = false, mode, document: doc = document }) {
  const dialog = doc.createElement("dialog");
  dialog.className = "game-options-dialog";
  dialog.id = "gameOptionsDialog";
  dialog.setAttribute("aria-labelledby", "gameOptionsTitle");
  const heading = doc.createElement("h2");
  heading.id = "gameOptionsTitle";
  heading.className = "text-2xl font-semibold";
  heading.textContent = game.name;
  const intro = doc.createElement("p");
  intro.className = "text-content-light mt-2";
  intro.textContent = "Choose how to use this game.";
  const body = doc.createElement("div");
  body.className = "game-options-fields";
  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "";
  body.append(status);
  const error = doc.createElement("p");
  error.className = "text-red-300 mt-3";
  error.setAttribute("role", "alert");
  const footer = doc.createElement("div");
  footer.className = "game-options-actions";
  let settled = false;
  let descriptor, selection, readSelection;
  let resolveChoice;
  const answer = new Promise(resolve => { resolveChoice = resolve; });
  const finish = value => {
    if (settled) return;
    settled = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (trigger?.isConnected) trigger.focus();
    resolveChoice(value);
  };
  const cancel = createButton({ text: "Cancel", onClick: () => finish(null) }, doc);
  const proceed = createButton({ text: "Continue", disabled: true, onClick: () => {
    finish({ game: descriptor, ...readSelection() });
  } }, doc);
  proceed.id = "gameOptionsContinue";
  footer.append(cancel, proceed);
  dialog.append(heading, intro, body, error, footer);
  dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
  dialog.addEventListener("close", () => finish(null));
  doc.body.append(dialog);
  dialog.showModal();

  function selectField(id, labelText, choices, selected, parent = body) {
    const label = doc.createElement("label");
    label.className = "game-options-field";
    label.htmlFor = id;
    const caption = doc.createElement("span");
    caption.className = "font-semibold text-sm";
    caption.textContent = labelText;
    const select = doc.createElement("select");
    select.id = id;
    select.className = "paper-input";
    for (const item of choices) {
      const option = doc.createElement("option");
      option.value = item.id; option.textContent = item.label;
      select.append(option);
    }
    select.value = selected;
    label.append(caption, select); parent.append(label);
    return select;
  }

  function load() {
    error.textContent = "";
    status.textContent = "";
    try {
      descriptor = loadGameOptions(game);
      if (settled) return;
      const store = createStore(storage, game.id);
      selection = normalizeOptions(descriptor, store.load());
      if (!alwaysShow && !hasGameOptions(descriptor)) {
        finish({ game: descriptor, ...selection, mode: "cards" });
        return;
      }
      body.replaceChildren();
      let modeControl;
      if (game.id === "mtg") modeControl = selectField("game-option-mode", "Make", [
        { id: "cards", label: "Card images" }, { id: "translation", label: "Text translation" },
      ], mode || (storage.getItem(`game-mode:${game.id}`) === "translation" ? "translation" : "cards"));
      const cardFields = doc.createElement("div");
      cardFields.className = "game-options-fields";
      body.append(cardFields);
      const formatControl = descriptor.formats.length > 1 ? selectField("game-option-format", "Deck format", descriptor.formats, selection.format, cardFields) : null;
      const sourceControl = descriptor.sourceChoices?.length > 1 ? selectField("game-option-source", "Image source", descriptor.sourceChoices, selection.source, cardFields) : null;
      const scenarioControl = descriptor.scenarioChoices?.length > 1 ? selectField("game-option-scenario", "Scenario mode", descriptor.scenarioChoices, selection.scenario, cardFields) : null;
      const workflowControl = descriptor.workflows.length > 1 ? selectField("game-option-workflow", "Print setup", descriptor.workflows.map(id => ({ id,
        label: id === "double_sided" ? "Pair fronts and backs" : game.id === "mtg" ? "Print faces separately" : "Fronts only",
      })), selection.workflow, cardFields) : null;
      let backDir = selection.localBackDir;
      let backLabel;
      if (game.id === "lotr_lcg") {
        const backSection = doc.createElement("div");
        backSection.className = "game-options-field";
        const title = doc.createElement("p"); title.className = "font-semibold text-sm";
        title.textContent = "Local back scans (optional)";
        backLabel = doc.createElement("p"); backLabel.className = "text-sm text-content-light break-words";
        backLabel.textContent = backDir || "No folder selected.";
        const actions = doc.createElement("div"); actions.className = "flex flex-wrap gap-2";
        const browse = createButton({ text: "Choose folder", size: "compact", onClick: async () => {
          browse.disabled = true;
          try {
            const chosen = await chooseDirectory();
            if (chosen && !settled) { backDir = chosen.path || chosen; backLabel.textContent = backDir; }
          } catch (err) { error.textContent = err.message; }
          finally { browse.disabled = false; }
        } }, doc);
        actions.append(browse, createButton({ text: "Clear", size: "compact", onClick: () => {
          backDir = ""; backLabel.textContent = "No folder selected.";
        } }, doc));
        backSection.append(title, backLabel, actions); cardFields.append(backSection);
      }
      readSelection = () => ({ ...selection,
        format: formatControl?.value || selection.format,
        source: sourceControl?.value || selection.source,
        scenario: scenarioControl?.value || selection.scenario,
        workflow: workflowControl?.value || selection.workflow,
        localBackDir: backDir, mode: modeControl?.value || "cards",
      });
      const drafts = new Map();
      formatControl?.addEventListener("change", () => {
        drafts.set(selection.format, { ...readSelection(), format: selection.format });
        selection = normalizeOptions(descriptor, drafts.get(formatControl.value) || store.load(formatControl.value), formatControl.value);
        if (sourceControl) sourceControl.value = selection.source;
        if (scenarioControl) scenarioControl.value = selection.scenario;
        if (workflowControl) workflowControl.value = selection.workflow;
        backDir = selection.localBackDir;
        if (backLabel) backLabel.textContent = backDir || "No folder selected.";
      });
      const updateMode = () => { cardFields.hidden = modeControl?.value === "translation"; };
      modeControl?.addEventListener("change", updateMode);
      updateMode();
      proceed.disabled = false;
      (modeControl || formatControl || sourceControl || workflowControl || proceed).focus();
    } catch (err) {
      if (settled) return;
      error.textContent = err.message || "Options could not load.";
      body.replaceChildren(createButton({ text: "Retry", size: "compact", onClick: load }, doc));
    }
  }
  load();
  return answer;
}

module.exports = { loadGameOptions, normalizeOptions, hasGameOptions, saveGameOptions, optionsSummary, chooseGameOptions };
