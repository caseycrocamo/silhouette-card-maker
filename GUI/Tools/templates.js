"use strict";
const { ipcRenderer } = require("electron");
const path = require("path");
const $ = id => document.getElementById(id);
let catalog, outputDir = "", outputFile = "", active = false, cancelRequested = false;
function selected(name) { return document.querySelector(`input[name="${name}"]:checked`).value; }
function fill(select, values) { select.replaceChildren(...values.map(x => new Option(`${x.name} (${x.width} × ${x.height})`, x.name))); }
function requestBase() {
  const req = { variant: $("variant").value, orientation: $("orientation").value, save: $("saveLayout").checked };
  if (selected("cardMode") === "named") req.card_size = $("cardSize").value;
  else { req.card_width = $("cardWidth").value.trim(); req.card_height = $("cardHeight").value.trim(); }
  if ($("cardRadius").value.trim()) req.card_radius = $("cardRadius").value.trim();
  if ($("cardName").value.trim()) req.card_name = $("cardName").value.trim();
  if (selected("paperMode") === "named") req.paper_size = $("paperSize").value;
  else { req.paper_width = $("paperWidth").value.trim(); req.paper_height = $("paperHeight").value.trim(); }
  if ($("paperName").value.trim()) req.paper_name = $("paperName").value.trim();
  req.output_path = outputFile || path.join(outputDir || ".", "cutting-template.dxf");
  return req;
}
function resultRow(item) {
  const row = document.createElement("article"); row.className = "template-result";
  row.textContent = item.error ? `Error: ${item.error}` : item.skipped ? `Skipped ${item.paper_size || ""} + ${item.card_size || ""}${item.reason ? ` (${item.reason})` : " (already exists)"}` : `${item.paper_size || ""} + ${item.card_size || ""} · ${item.variant || "default"} · ${item.orientation || ""} · ${item.cols || "?"} × ${item.rows || "?"} cards · ${item.path || ""}`;
  return row;
}
function show(items) {
  const host = $("results"); host.replaceChildren();
  for (const item of items || []) host.append(resultRow(item));
}
async function run(payload) {
  if (active) return;
  active = true;
  document.querySelectorAll("#templateForm button").forEach(button => button.disabled = true);
  $("cancel").disabled = false;
  $("status").textContent = "Generating…"; $("progress").classList.remove("hidden");
  try { const result = await ipcRenderer.invoke("template-request", payload); show(result.items || [result]); $("status").textContent = result.ok ? "Generation complete." : "Some templates could not be generated."; }
  catch (error) { $("status").textContent = error.message || String(error); }
  finally { active = false; document.querySelectorAll("#templateForm button").forEach(button => button.disabled = false); $("progress").classList.add("hidden"); }
}
async function runBatch(mode) {
  if (active) return;
  active = true; cancelRequested = false;
  document.querySelectorAll("#templateForm button").forEach(button => button.disabled = true);
  $("cancel").disabled = false;
  const host = $("results"); host.replaceChildren();
  const progress = $("progress"); progress.max = 1; progress.value = 0; progress.classList.remove("hidden");
  const onProgress = (_event, update) => {
    progress.max = update.total || 1; progress.value = update.completed || 0;
    $("status").textContent = `Generated ${update.completed || 0} of ${update.total || 0} templates.`;
    if (update.item) host.append(resultRow(update.item));
  };
  ipcRenderer.on("template-batch-progress", onProgress);
  try {
    const result = await ipcRenderer.invoke("template-batch", { mode, output_dir: outputDir });
    if (result.items && !host.childElementCount) result.items.forEach(item => host.append(resultRow(item)));
    $("status").textContent = result.canceled ? "Batch stopped." : result.ok ? "Generation complete." : "Some templates could not be generated.";
  } catch (error) { $("status").textContent = error.message || String(error); }
  finally { ipcRenderer.removeListener("template-batch-progress", onProgress); active = false; document.querySelectorAll("#templateForm button").forEach(button => button.disabled = false); $("progress").classList.add("hidden"); }
}
window.addEventListener("DOMContentLoaded", async () => {
  try {
    catalog = await ipcRenderer.invoke("template-request", { command: "list" });
    fill($("cardSize"), catalog.card_sizes); fill($("paperSize"), catalog.paper_sizes);
    outputDir = catalog.output_dir || ""; $("outputDir").value = outputDir;
    outputFile = path.join(outputDir || ".", "cutting-template.dxf"); $("outputFile").value = outputFile;
  } catch (error) { $("catalogError").textContent = error.message || String(error); }
  for (const name of ["cardMode", "paperMode"]) document.querySelectorAll(`input[name="${name}"]`).forEach(input => input.addEventListener("change", () => {
    const card = name === "cardMode";
    const custom = input.checked && input.value === "custom";
    (card ? $("cardSize") : $("paperSize")).disabled = custom;
    for (const id of card ? ["cardWidth", "cardHeight"] : ["paperWidth", "paperHeight"]) $(id).disabled = !custom;
  }));
  $("templateForm").addEventListener("submit", event => { event.preventDefault(); run({ command: "single", ...requestBase() }); });
  $("chooseFolder").onclick = async () => {
    const selectedPath = await ipcRenderer.invoke("select-template-path", { kind: "directory", defaultPath: outputDir });
    if (selectedPath) { outputDir = selectedPath; $("outputDir").value = selectedPath; }
  };
  $("chooseFile").onclick = async () => {
    const selectedPath = await ipcRenderer.invoke("select-template-path", { kind: "dxf", defaultPath: outputFile });
    if (selectedPath) { outputFile = selectedPath; $("outputFile").value = selectedPath; outputDir = path.dirname(selectedPath); $("outputDir").value = outputDir; }
  };
  $("cancel").onclick = () => { cancelRequested = true; ipcRenderer.invoke("cancel-template-request").catch(() => {}); $("status").textContent = "Finishing the current template…"; };
  $("batchMissing").onclick = () => runBatch("missing");
  $("batchAll").onclick = () => runBatch("all");
  $("batchOptimize").onclick = () => runBatch("optimize");
});
