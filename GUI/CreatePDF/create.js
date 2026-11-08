"use strict";
const { ipcRenderer } = require("electron");
const {
  getFrontDir,
  getBackDir,
  getDoubleSidedDir,
  getOutputDir,
} = require("../shared/constants");
const api = require("../shared/pdfCreationSettings");
const { createButton } = require("../shared/button");
let sourceRevision = 0;
let metadata,
  settings,
  defaults,
  frontFiles = [],
  doubleFiles = [],
  busy = false,
  pdfDestination,
  imageDestination;
const key = "pdfCreationSettings.v1";
let settingsSnapshot = null;
let category = "page";
let previewSide = "front";
let previewTimer;
let previewRevision = 0;
const dialog = () => el("pdfSettingsDialog");
const labels = {
  only_fronts: "Print mode",
  skip: "Skipped sheet positions",
  load_offset: "Apply saved printer offset",
  registration: "Registration marks",
  registration_orientation: "Registration orientation",
  specialty: "Specialty preset",
  show_outline: "Show cutting outline",
  output_images: "Output format",
  output_path: "Destination",
  front_dir_path: "Front image folder",
  back_dir_path: "Generic back folder",
  double_sided_dir_path: "Double-sided image folder",
  fit: "Front and paired reverse fit",
  fit_backs: "Generic back fit",
  crop: "Front and paired reverse crop",
  crop_backs: "Generic back crop",
  extend_edges: "Front edge extension",
  extend_edges_backs: "Back edge extension",
  extend_corners: "Front corner extension",
  extend_corners_backs: "Back corner extension",
  extend_bleed: "Front page bleed",
  extend_bleed_backs: "Back page bleed",
  ppi: "Resolution (PPI)",
  quality: "PDF compression quality",
  label: "Page label",
  borderless: "Tighter margins",
  card_size: "Card size",
  paper_size: "Paper size",
};
const descriptions = {
  skip: "Zero-based sheet slots, not source card numbers. Separate positions with commas.",
  load_offset: "Uses saved printer calibration data.",
  crop: "Units: mm, in, or %. A bare value means percent.",
  crop_backs: "Units: mm, in, or %. A bare value means percent.",
  extend_edges: "Units: mm, in, or layout pixels.",
  extend_edges_backs: "Units: mm, in, or layout pixels.",
  extend_corners: "Units: mm, in, or layout pixels.",
  extend_corners_backs: "Units: mm, in, or layout pixels.",
  extend_bleed: "Units: mm, in, or layout pixels.",
  extend_bleed_backs: "Units: mm, in, or layout pixels.",
  quality: "PDF compression setting. PNG size is not controlled by this value.",
  only_fronts: "Changing print mode does not rebuild exported card images.",
};
const groups = {
  page: api.GROUPS.page,
  image: api.GROUPS.image,
  file: api.GROUPS.file,
};
function el(id) {
  return document.getElementById(id);
}
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function valuesFor(name) {
  if (name === "card_size")
    return metadata.card_sizes.map(
      (x) => `${x.name} (${x.width} × ${x.height})`,
    );
  if (name === "paper_size")
    return metadata.paper_sizes.map(
      (x) => `${x.name} (${x.width} × ${x.height})`,
    );
  if (name === "specialty")
    return metadata.specialty_layouts.map((x) => x.name);
  if (name === "registration_orientation")
    return [
      "auto",
      ...(metadata.options.find((o) => o.name === name)?.choices || []),
    ];
  return null;
}
function controlFor(o) {
  const n = o.name,
    v = settings[n],
    choices = valuesFor(n) || o.choices;
  let type = o.is_flag ? "checkbox" : "text",
    node;
  if (n === "only_fronts") {
    type = "select";
    node = document.createElement("select");
    [
      ["false", "Fronts and backs"],
      ["true", "Fronts only"],
    ].forEach(([x, t]) => node.add(new Option(t, x)));
    node.value = String(!!v);
  } else if (n === "output_images") {
    type = "select";
    node = document.createElement("select");
    [
      ["false", "PDF"],
      ["true", "PNG pages"],
    ].forEach(([x, t]) => node.add(new Option(t, x)));
    node.value = String(!!v);
  } else if (n === "fit_backs") {
    type = "select";
    node = document.createElement("select");
    ["same as fronts", ...(choices || [])].forEach((x) =>
      node.add(new Option(x.charAt(0).toUpperCase() + x.slice(1), x)),
    );
    node.value = v || "same as fronts";
  } else if (choices && choices.length) {
    node = document.createElement("select");
    if (n === "specialty") node.add(new Option("None (standard layout)", ""));
    choices.forEach((x) => {
      const value = ["card_size", "paper_size"].includes(n)
        ? x.split(" (")[0]
        : x;
      const display =
        n === "registration"
          ? `${x} marks`
          : x === "auto"
            ? "Automatic"
            : x.charAt(0).toUpperCase() + x.slice(1).replaceAll("_", " ");
      node.add(new Option(display, value));
    });
    node.value =
      n === "registration_orientation" ? v || "auto" : v == null ? "" : v;
  } else if (o.is_flag) {
    node = document.createElement("input");
    node.type = "checkbox";
    node.checked = !!v;
  } else {
    node = document.createElement("input");
    node.type = o.min != null || o.max != null ? "number" : "text";
    if (o.min != null) node.min = o.min;
    if (o.max != null) node.max = o.max;
    if (Number.isInteger(o.min) && Number.isInteger(o.max)) node.step = "1";
    node.value = Array.isArray(v) ? v.join(", ") : (v ?? "");
  }
  node.id = `setting-${n}`;
  node.className = "control";
  node.setAttribute("aria-describedby", `help-${n} error-${n}`);
  node.dataset.name = n;
  const wrap = document.createElement("label");
  wrap.className = "setting";
  const title = document.createElement("span");
  title.textContent = labels[n] || n.replaceAll("_", " ");
  wrap.append(title, node);
  let help = descriptions[n] || "";
  if (n === "registration")
    help = "Three or four marks. This changes marks, not card layout.";
  if (n === "specialty")
    help = "Specialty controls page geometry; registration remains editable.";
  const small = document.createElement("small");
  small.id = `help-${n}`;
  small.textContent = help;
  wrap.append(small);
  const err = document.createElement("small");
  err.id = `error-${n}`;
  err.className = "setting-error";
  wrap.append(err);
  if (n === "specialty") {
    const geometry = document.createElement("small");
    geometry.id = "specialtyGeometry";
    wrap.append(geometry);
  }
  if (n === "load_offset") {
    const link = document.createElement("a");
    link.href = "../Settings/settings.html";
    link.textContent = "Open printer calibration settings";
    wrap.append(link);
  }
  const updateValue = () => {
    const value =
      node.type === "checkbox"
        ? node.checked
        : ["only_fronts", "output_images"].includes(n)
          ? node.value === "true"
          : node.value;
    // Selects emit both input and change. Apply each transition once.
    if (settings[n] === value) return;
    settings[n] = value;
    changed(n);
  };
  node.addEventListener("input", updateValue);
  node.addEventListener("change", updateValue);
  if (
    [
      "output_path",
      "front_dir_path",
      "back_dir_path",
      "double_sided_dir_path",
    ].includes(n)
  ) {
    node.readOnly = true;
    const b = createButton({
      size: "compact",
      text: n === "output_path" ? "Choose destination" : "Choose folder",
    });
    b.addEventListener("click", () =>
      choosePath(n).catch((error) =>
        showErrors({ [n]: error.message || String(error) }),
      ),
    );
    wrap.append(b);
  }
  return wrap;
}
function render() {
  for (const [g, ns] of Object.entries(groups)) {
    const c = el(
      g === "page"
        ? "pageControls"
        : g === "image"
          ? "imageControls"
          : "fileControls",
    );
    c.innerHTML = "";
    for (const n of ns) {
      const o = metadata.options.find((x) => x.name === n);
      if (o) c.append(controlFor(o));
    }
  }
  const skip = el("setting-skip");
  if (skip) {
    const wrap = document.createElement("label");
    wrap.className = "setting";
    const shortcut = document.createElement("input");
    shortcut.type = "checkbox";
    shortcut.className = "control";
    shortcut.id = "skip4Checkbox";
    shortcut.checked = (
      Array.isArray(settings.skip)
        ? settings.skip
        : String(settings.skip || "").split(/[ ,]+/)
    )
      .map(Number)
      .includes(4);
    shortcut.addEventListener("change", () => {
      let items = Array.isArray(settings.skip)
        ? settings.skip
        : String(settings.skip || "")
            .split(/[ ,]+/)
            .filter(Boolean)
            .map(Number);
      items = shortcut.checked
        ? [...items, 4]
        : items.filter((x) => Number(x) !== 4);
      settings.skip = [...new Set(items)];
      skip.value = settings.skip.join(", ");
      persist();
      schedulePreview();
    });
    wrap.append(shortcut, document.createTextNode(" Skip sheet slot 4"));
    skip.parentElement.after(wrap);
  }
  organizeSettingsRows();
  sync();
  syncLayoutChoices();
  filterSettings();
  schedulePreview();
}
function persist() {
  if (dialog()?.open) return;
  sessionStorage.setItem(
    key,
    JSON.stringify({ version: 1, settings, pdfDestination, imageDestination }),
  );
  sessionStorage.setItem("onlyFronts", String(!!settings.only_fronts));
  sessionStorage.setItem(
    "cardWorkflow",
    settings.only_fronts ? "front_only" : "double_sided",
  );
}
function changed(n) {
  if (n === "skip" && el("skip4Checkbox")) {
    const values = Array.isArray(settings.skip)
      ? settings.skip
      : String(settings.skip || "")
          .split(/[ ,]+/)
          .filter(Boolean);
    el("skip4Checkbox").checked = values.some((value) => Number(value) === 4);
  }
  persist();
  schedulePreview();
  if (n === "only_fronts") sync();
  if (n === "specialty" || n === "borderless") {
    sync();
    syncLayoutChoices();
  }
  if (n === "card_size" || n === "paper_size") syncLayoutChoices();
  if (n === "output_images") {
    syncOutputPath();
    sync();
  }
}
function sync() {
  const fronts = !!settings.only_fronts;
  if (!dialog().open) {
    el("doubleSidedSection").classList.toggle("hidden", fronts);
    el("backImageSection").classList.toggle("hidden", fronts);
  }
  const orphanFiles = doubleFiles.filter((name) => !frontFiles.includes(name));
  const conflict = (fronts && doubleFiles.length > 0) || orphanFiles.length > 0;
  el("conflictWarning").classList.toggle("hidden", !conflict);
  el("conflictText").textContent =
    fronts && doubleFiles.length
      ? "Fronts only is selected, but double-sided images exist."
      : orphanFiles.length
        ? `No matching front image for: ${orphanFiles.join(", ")}`
        : "";
  document
    .querySelectorAll('[data-name$="_backs"]')
    .forEach((c) => c.closest(".setting").classList.toggle("hidden", fronts));
  const spec = !!settings.specialty;
  const geometry = el("specialtyGeometry");
  const preset = metadata.specialty_layouts.find(
    (x) => x.name === settings.specialty,
  );
  if (geometry)
    geometry.textContent = preset
      ? `${preset.paper_size.name} ${preset.paper_size.width} × ${preset.paper_size.height}; ${preset.card_size.name} ${preset.card_size.width} × ${preset.card_size.height}; ${preset.num_rows} rows × ${preset.num_cols} columns.`
      : "";
  for (const n of ["card_size", "paper_size", "borderless"]) {
    const c = el(`setting-${n}`);
    if (c) {
      c.disabled = spec;
      if (c.parentElement) c.parentElement.style.opacity = spec ? ".55" : "";
    }
  }
  el("previewBack").disabled = fronts;
  if (fronts) previewSide = "front";
  const btn = el("createPdfBtn");
  if (btn)
    btn.textContent = settings.output_images ? "Create images" : "Create PDF";
  if (!dialog().open)
    el("settingsSummary").textContent =
      `${settings.specialty || settings.paper_size} · ${settings.card_size} · ${fronts ? "Fronts only" : "Fronts and backs"} · ${settings.ppi} PPI`;
}
function syncLayoutChoices() {
  for (const [field, other] of [
    ["card_size", "paper_size"],
    ["paper_size", "card_size"],
  ]) {
    const select = el(`setting-${field}`);
    if (!select) continue;
    for (const option of select.options) {
      if (!option.value) continue;
      option.disabled = !metadata.layouts.some(
        (layout) =>
          String(layout[field]).toLowerCase() === option.value.toLowerCase() &&
          String(layout[other]).toLowerCase() ===
            String(settings[other]).toLowerCase() &&
          layout.variants.some(
            (v) =>
              v.name ===
              (settings.borderless && !settings.specialty
                ? "borderless"
                : "default"),
          ),
      );
    }
  }
}
function syncOutputPath() {
  const path = require("path");
  const current = settings.output_path || path.join(getOutputDir(), "game.pdf");
  if (settings.output_images) {
    if (/\.pdf$/i.test(current)) pdfDestination = current;
    imageDestination = imageDestination || path.dirname(current);
    settings.output_path = imageDestination;
  } else {
    if (!/\.pdf$/i.test(current)) imageDestination = current;
    settings.output_path =
      pdfDestination || path.join(getOutputDir(), "game.pdf");
  }
  persist();
  const input = el("setting-output_path");
  if (input) input.value = settings.output_path;
}
function imageCard(path, f) {
  const d = document.createElement("div");
  d.className = "text-center";
  const i = document.createElement("img");
  i.src = require("url").pathToFileURL(require("path").join(path, f)).href;
  i.alt = f;
  i.loading = "lazy";
  i.decoding = "async";
  i.style = "width:90px;height:125px;object-fit:cover";
  let timer;
  i.addEventListener("mouseenter", () => {
    timer = setTimeout(() => {
      const preview = document.createElement("img");
      preview.src = i.src;
      preview.alt = f;
      preview.style =
        "position:fixed;z-index:1000;left:20px;top:20px;max-width:400px;max-height:560px;background:white;padding:4px;box-shadow:0 8px 24px #0005";
      preview.id = "hoverPreview";
      document.body.append(preview);
    }, 700);
  });
  i.addEventListener("mouseleave", () => {
    clearTimeout(timer);
    el("hoverPreview")?.remove();
  });
  d.append(i);
  const s = document.createElement("div");
  s.textContent = f;
  d.append(s);
  return d;
}
async function loadSources() {
  if (dialog().open) return;
  const revision = ++sourceRevision;
  const sources = { ...settings };
  try {
    const [nextFronts, nextDoubles, backs] = await Promise.all([
      ipcRenderer.invoke("get-front-images", sources.front_dir_path),
      ipcRenderer.invoke(
        "get-double-sided-images",
        sources.double_sided_dir_path,
      ),
      ipcRenderer.invoke("get-back-images", sources.back_dir_path),
    ]);
    if (revision !== sourceRevision) return;
    frontFiles = nextFronts;
    doubleFiles = nextDoubles;
    el("frontImagesGrid").replaceChildren(
      ...frontFiles.map((f) => imageCard(sources.front_dir_path, f)),
    );
    el("doubleSidedImagesGrid").replaceChildren(
      ...doubleFiles.map((f) => imageCard(sources.double_sided_dir_path, f)),
    );
    el("backImagePreview").replaceChildren(
      ...backs.map((f) => imageCard(sources.back_dir_path, f)),
    );
    sync();
  } catch (e) {
    el("validationSummary").textContent = String(e);
  }
}
async function choosePath(n) {
  const kind =
    n === "output_path"
      ? settings.output_images
        ? "directory"
        : "pdf"
      : "directory";
  const snapshotAtSelection = settingsSnapshot;
  const r = await ipcRenderer.invoke("select-pdf-setting-path", {
    kind,
    defaultPath: settings[n],
  });
  if (snapshotAtSelection && snapshotAtSelection !== settingsSnapshot) return;
  if (r && !r.canceled) {
    settings[n] = r.path || r;
    if (n === "output_path") {
      if (settings.output_images) imageDestination = settings[n];
      else pdfDestination = settings[n];
    }
    persist();
    render();
    if (!dialog().open) loadSources();
  }
}
function showErrors(errors) {
  for (const option of metadata.options) {
    const oldError = el(`error-${option.name}`);
    if (oldError) oldError.textContent = "";
  }
  el("validationSummary").textContent = Object.entries(errors)
    .map(([name, message]) => `${labels[name] || name}: ${message}`)
    .join(" ");
  for (const [n, m] of Object.entries(errors)) {
    const e = el(`error-${n}`);
    if (e) e.textContent = m;
  }
  el("dialogErrors").textContent = el("validationSummary").textContent;
  const first = Object.keys(errors)[0];
  if (first) {
    const node = el(`setting-${first}`);
    if (node) {
      if (!dialog().open) openSettings();
      category =
        Object.keys(groups).find((k) => groups[k].includes(first)) || "page";
      el("settingsSearch").value = "";
      filterSettings();
      const advanced = node.closest("details");
      if (advanced) advanced.open = true;
    }
    node?.focus();
  }
}
function showResult(data) {
  if (
    !data ||
    !["pdf", "images"].includes(data.kind) ||
    typeof data.destination !== "string" ||
    !Array.isArray(data.files)
  )
    return;
  const completion = el("completion");
  completion.classList.remove("hidden");
  completion.textContent =
    data.kind === "images"
      ? `Created ${data.files.length} PNG page(s) in ${data.destination}. `
      : `Created PDF: ${data.destination}. `;
  if (data.kind === "images") {
    const button = createButton({ text: "Open folder" });
    button.onclick = () =>
      ipcRenderer
        .invoke("open-pdf-output-folder", data.destination)
        .catch((error) => {
          el("validationSummary").textContent = error.message || String(error);
        });
    completion.append(button);
  }
  const text = [...(data.warnings || []), data.log || ""].join("\n").trim();
  if (text) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Generation log";
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = text;
    details.append(summary, pre);
    completion.append(details);
  }
}
async function create() {
  if (busy) return;
  const argv = api.toArgv(settings, metadata),
    errs = api.validate(settings, metadata);
  showErrors(errs);
  if (Object.keys(errs).length) return;
  busy = true;
  el("settingsPanel").inert = true;
  el("resetSettings").disabled = true;
  el("completion").classList.add("hidden");
  el("createPdfBtn").disabled = true;
  window.showLoadingOverlay({
    title: settings.output_images ? "Creating images" : "Creating PDF",
    message: "Processing card images…",
  });
  try {
    const pf = await ipcRenderer.invoke("preflight-create-pdf", argv);
    if (pf.errors && Object.keys(pf.errors).length) {
      showErrors(pf.errors);
      return;
    }
    if (pf.warnings?.length)
      el("validationSummary").textContent = pf.warnings.join(" ");
    const result = await ipcRenderer.invoke("run-create-pdf", argv);
    if (result?.canceled) return;
    const data = result.result || result;
    settings.output_path = data.destination;
    if (data.kind === "pdf") pdfDestination = data.destination;
    else imageDestination = data.destination;
    persist();
    const completed = { ...data, warnings: pf.warnings || [] };
    sessionStorage.setItem("pdfCreationLastResult", JSON.stringify(completed));
    showResult(completed);
    if (data.kind === "pdf")
      location.href = `../Utilities/pdf_viewer.html?path=${encodeURIComponent(data.destination)}`;
  } catch (e) {
    el("validationSummary").textContent =
      `Could not create output: ${e.message || e}`;
  } finally {
    busy = false;
    el("settingsPanel").inert = false;
    el("resetSettings").disabled = false;
    el("createPdfBtn").disabled = false;
    window.hideLoadingOverlay();
  }
}
window.addEventListener("DOMContentLoaded", async () => {
  setupSettingsDialog();
  el("showDoubleSided").onclick = () => {
    el("doubleSidedSection").classList.remove("hidden");
    el("doubleSidedSection").scrollIntoView();
  };
  try {
    metadata = await ipcRenderer.invoke("get-pdf-capabilities");
    const paths = {
      front_dir_path: getFrontDir(),
      back_dir_path: getBackDir(),
      double_sided_dir_path: getDoubleSidedDir(),
      output_path: `${getOutputDir()}/game.pdf`,
    };
    defaults = api.defaults(metadata, paths);
    pdfDestination = paths.output_path;
    ipcRenderer
      .invoke("offset-data-exists")
      .then((exists) => {
        const control = el("setting-load_offset");
        if (control)
          control.closest(".setting").querySelector("small").textContent =
            exists
              ? "Saved printer offset data is available."
              : "No saved offset data. You can continue without it or calibrate in Settings.";
      })
      .catch(() => {});
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {}
    if (
      saved?.version !== 1 ||
      !saved.settings ||
      typeof saved.settings !== "object" ||
      Array.isArray(saved.settings)
    )
      saved = null;
    settings = saved
      ? { ...defaults, ...saved.settings }
      : { ...defaults, skip: [] };
    pdfDestination =
      saved?.pdfDestination ||
      (!settings.output_images ? settings.output_path : paths.output_path);
    imageDestination =
      saved?.imageDestination ||
      (settings.output_images ? settings.output_path : undefined);
    const wf = sessionStorage.getItem("onlyFronts");
    if (wf !== null && (!saved || String(saved.settings.only_fronts) !== wf))
      settings.only_fronts = wf === "true";
    render();
    persist();
    el("openSettings").disabled = false;
    el("createPdfBtn").disabled = false;
    void loadSources();
    try {
      showResult(
        JSON.parse(sessionStorage.getItem("pdfCreationLastResult") || "null"),
      );
    } catch {}
  } catch (e) {
    el("metadataError").textContent =
      `PDF settings could not load. Retry: ${e.message || e}`;
    el("metadataError").classList.remove("hidden");
    const b = createButton({ text: "Retry", size: "compact" });
    b.onclick = () => location.reload();
    el("metadataError").append(b);
    return;
  }
  el("resetSettings").onclick = () => {
    settings = { ...defaults, skip: [] };
    pdfDestination = defaults.output_path;
    imageDestination = undefined;
    el("completion").classList.add("hidden");
    showErrors({});
    render();
    persist();
    if (!dialog().open) loadSources();
  };
  el("createPdfBtn").onclick = create;
  const sourceActions = {
    clearFrontBtn: ["clear-front-images", "front_dir_path"],
    clearDoubleSidedBtn: ["clear-double-sided-images", "double_sided_dir_path"],
    uploadDoubleSidedBtn: [
      "upload-double-sided-images",
      "double_sided_dir_path",
    ],
    uploadBackBtn: ["select-back-image", "back_dir_path"],
    clearBackBtn: ["clear-back-image", "back_dir_path"],
  };
  for (const [id, [channel, field]] of Object.entries(sourceActions)) {
    el(id).onclick = async () => {
      if (busy) return;
      el(id).disabled = true;
      try {
        const result = await ipcRenderer.invoke(channel, settings[field]);
        el("validationSummary").textContent =
          typeof result === "string" ? result : "";
        await loadSources();
      } catch (error) {
        el("validationSummary").textContent = error.message || String(error);
      } finally {
        el(id).disabled = false;
      }
    };
  }
  ipcRenderer.on("front-images-changed", loadSources);
  ipcRenderer.on("double-sided-images-changed", loadSources);
  ipcRenderer.on("back-images-changed", loadSources);
});

function filterSettings() {
  const query = el("settingsSearch").value.trim().toLowerCase();
  let matches = 0;
  document.querySelectorAll("[data-settings-category]").forEach((section) => {
    const selected = section.dataset.settingsCategory === category;
    let visible = 0;
    section.querySelectorAll(".setting").forEach((row) => {
      const match = !query || row.textContent.toLowerCase().includes(query);
      row.hidden = !match;
      if (match && !row.classList.contains("hidden")) visible++;
      if (query && match && row.closest("details"))
        row.closest("details").open = true;
    });
    section.hidden = query ? visible === 0 : !selected;
    if (!section.hidden) matches += visible;
  });
  el("settingsNoResults").hidden = matches > 0;
  document.querySelectorAll(".category").forEach((button) => {
    const selected = button.dataset.category === category && !query;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}
function openSettings() {
  if (!settings || busy || dialog().open) return;
  settingsSnapshot = JSON.parse(
    JSON.stringify({ settings, pdfDestination, imageDestination }),
  );
  el("settingsSearch").value = "";
  category = "page";
  dialog().showModal();
  filterSettings();
  schedulePreview();
  el("settingsSearch").focus();
}
function cancelSettings() {
  if (!settingsSnapshot) return;
  ({ settings, pdfDestination, imageDestination } = settingsSnapshot);
  settingsSnapshot = null;
  ++previewRevision;
  clearTimeout(previewTimer);
  dialog().close();
  render();
  showErrors({});
  el("openSettings").focus();
}
function setupSettingsDialog() {
  el("openSettings").onclick = openSettings;
  el("closeSettings").onclick = cancelSettings;
  el("cancelSettings").onclick = cancelSettings;
  dialog().addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelSettings();
  });
  el("settingsSearch").addEventListener("input", filterSettings);
  document.querySelectorAll(".category").forEach(
    (button) =>
      (button.onclick = () => {
        category = button.dataset.category;
        el("settingsSearch").value = "";
        filterSettings();
        el("settingsPanel").scrollTop = 0;
      }),
  );
  el("saveSettings").onclick = async () => {
    const errors = api.validate(settings, metadata);
    showErrors(errors);
    if (Object.keys(errors).length) return;
    settingsSnapshot = null;
    ++previewRevision;
    clearTimeout(previewTimer);
    dialog().close();
    persist();
    sync();
    await loadSources();
    el("openSettings").focus();
  };
  for (const side of ["front", "back"])
    el(side === "front" ? "previewFront" : "previewBack").onclick = () => {
      previewSide = side;
      schedulePreview();
    };
}
function schedulePreview() {
  if (!dialog().open || !metadata) return;
  const same = (left, right) =>
    String(left).toLowerCase() === String(right).toLowerCase();
  const specialty = metadata.specialty_layouts.find((item) =>
    same(item.name, settings.specialty),
  );
  const layout = metadata.layouts.find(
    (item) =>
      same(item.paper_size, settings.paper_size) &&
      same(item.card_size, settings.card_size),
  );
  const preview = settings.specialty
    ? specialty?.preview
    : layout?.variants.find(
        (item) =>
          item.name === (settings.borderless ? "borderless" : "default"),
      )?.preview;
  if (preview) {
    ++previewRevision;
    clearTimeout(previewTimer);
    drawPagePreview(preview);
    el("pagePreview").setAttribute("aria-busy", "false");
    return;
  }
  el("pagePreview").textContent =
    "Choose a supported layout to see the page preview.";
  el("previewSummary").replaceChildren();
}
function drawPagePreview(layout) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${previewSide === "front" ? "Front" : "Back"} sheet layout`,
  );
  const add = (type, attributes) => {
    const node = document.createElementNS(ns, type);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, String(value));
    svg.append(node);
    return node;
  };
  const skips = new Set(
    (Array.isArray(settings.skip)
      ? settings.skip
      : String(settings.skip || "").split(/[ ,]+/)
    )
      .filter((value) => String(value).trim() !== "")
      .map(Number),
  );
  let position = 0,
    available = 0;
  for (const y of layout.y)
    for (const x of layout.x) {
      const skipped = skips.has(position);
      if (!skipped) available++;
      const px =
        previewSide === "back" ? layout.width - x - layout.card_width : x;
      add("rect", {
        x: px,
        y,
        width: layout.card_width,
        height: layout.card_height,
        rx: Math.min(layout.card_width, layout.card_height) * 0.04,
        fill: skipped ? "#fff" : "#e2e8f0",
        stroke: skipped ? "#cbd5e1" : "#94a3b8",
        "stroke-width": layout.width * 0.003,
        "stroke-dasharray": skipped
          ? `${layout.width * 0.012} ${layout.width * 0.008}`
          : "none",
      });
      const text = add("text", {
        x: px + layout.card_width / 2,
        y: y + layout.card_height / 2,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        fill: skipped ? "#94a3b8" : "#475569",
        "font-size": layout.width * 0.035,
      });
      text.textContent = skipped ? "×" : String(position);
      position++;
    }
  // Marks are schematic. Card positions come directly from the PDF layout resolver.
  const inset = layout.width * 0.045,
    size = layout.width * 0.045;
  for (const [right, bottom] of [
    [false, false],
    [true, false],
    [false, true],
    ...(settings.registration === "4" ? [[true, true]] : []),
  ]) {
    const x = right ? layout.width - inset : inset,
      y = bottom ? layout.height - inset : inset;
    add("path", {
      d: `M ${x + (right ? -size : size)} ${y} H ${x} V ${y + (bottom ? -size : size)}`,
      fill: "none",
      stroke: "#334155",
      "stroke-width": layout.width * 0.008,
    });
  }
  el("pagePreview").replaceChildren(svg);
  el("previewFront").setAttribute(
    "aria-pressed",
    String(previewSide === "front"),
  );
  el("previewBack").setAttribute(
    "aria-pressed",
    String(previewSide === "back"),
  );
  const preset = metadata.specialty_layouts.find(
    (item) => item.name === settings.specialty,
  );
  const card =
    preset?.card_size ||
    metadata.card_sizes.find((item) => item.name === settings.card_size);
  const data = [
    ["Paper", preset ? settings.specialty : settings.paper_size],
    ["Card size", card ? `${card.width} × ${card.height}` : settings.card_size],
    ["Positions per sheet", String(available)],
    ["Print sides", settings.only_fronts ? "Fronts only" : "Fronts & backs"],
  ];
  el("previewSummary").replaceChildren();
  for (const [name, value] of data) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = value;
    el("previewSummary").append(dt, dd);
  }
}

function organizeSettingsRows() {
  function build(container, specifications) {
    const rows = new Map(
      Array.from(container.querySelectorAll(".setting")).map((row) => [
        row.querySelector("[data-name]")?.dataset.name || "skip4",
        row,
      ]),
    );
    container.classList.remove("settings-rows");
    container.replaceChildren();
    for (const [title, names, advanced] of specifications) {
      const group = document.createElement(advanced ? "details" : "div");
      group.className = "settings-group";
      const heading = document.createElement(advanced ? "summary" : "h3");
      heading.textContent = title;
      group.append(heading);
      const box = document.createElement("div");
      box.className = "settings-rows";
      for (const name of names) if (rows.has(name)) box.append(rows.get(name));
      group.append(box);
      container.append(group);
    }
  }
  build(el("pageControls"), [
    ["Sheet setup", ["only_fronts", "paper_size", "card_size", "specialty"]],
    [
      "Printing & alignment",
      ["registration", "registration_orientation", "borderless", "load_offset"],
    ],
    ["Advanced page options", ["skip", "skip4", "label", "show_outline"], true],
  ]);
  build(el("imageControls"), [
    [
      "Fronts & paired reverse images",
      ["fit", "crop", "extend_edges", "extend_corners", "extend_bleed"],
    ],
    [
      "Generic backs & back-page bleed",
      [
        "fit_backs",
        "crop_backs",
        "extend_edges_backs",
        "extend_corners_backs",
        "extend_bleed_backs",
      ],
    ],
  ]);
  build(el("fileControls"), [
    ["Output", ["output_images", "output_path", "ppi", "quality"]],
    [
      "Source folders",
      ["front_dir_path", "back_dir_path", "double_sided_dir_path"],
    ],
  ]);
}
