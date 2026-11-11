"use strict";
const layoutCatalog = require("./layoutCatalog");

const GROUPS = {
  page: [
    "only_fronts",
    "paper_size",
    "card_size",
    "registration",
    "registration_orientation",
    "specialty",
    "borderless",
    "skip",
    "load_offset",
    "label",
    "show_outline",
  ],
  image: [
    "fit",
    "fit_backs",
    "crop",
    "crop_backs",
    "extend_edges",
    "extend_edges_backs",
    "extend_corners",
    "extend_corners_backs",
    "extend_bleed",
    "extend_bleed_backs",
  ],
  file: [
    "ppi",
    "quality",
    "output_images",
    "output_path",
    "front_dir_path",
    "back_dir_path",
    "double_sided_dir_path",
  ],
};
const MANAGED_PATHS = [
  "front_dir_path",
  "back_dir_path",
  "double_sided_dir_path",
];

function defaults(metadata, paths = {}) {
  const out = {};
  for (const option of metadata.options || [])
    out[option.name] = option.default;
  for (const name of MANAGED_PATHS) if (paths[name]) out[name] = paths[name];
  if (paths.output_path) out.output_path = paths.output_path;
  out.skip = Array.isArray(out.skip) ? out.skip : [];
  return out;
}

function inactiveOptions(settings) {
  const inactive = new Set();
  if (settings.specialty)
    for (const name of ["card_size", "paper_size", "borderless"])
      inactive.add(name);
  if (settings.only_fronts)
    for (const name of GROUPS.image)
      if (name.endsWith("_backs")) inactive.add(name);
  return inactive;
}

function validate(settings, metadata) {
  const errors = {};
  const allowed = new Set((metadata.options || []).map((o) => o.name));
  const inactive = inactiveOptions(settings);
  for (const o of metadata.options || []) {
    if (inactive.has(o.name)) continue;
    const v = settings[o.name];
    if (o.is_flag || v === undefined || v === null || v === "") continue;
    if (["ppi", "quality"].includes(o.name) && !Number.isInteger(Number(v)))
      errors[o.name] = "Enter a whole number.";
    const vals = o.multiple ? (Array.isArray(v) ? v : [v]) : [v];
    if (
      o.choices &&
      vals.some((x) => {
        if (
          o.name === "registration_orientation" &&
          String(x).toLowerCase() === "auto"
        )
          return false;
        if (
          o.name === "fit_backs" &&
          String(x).toLowerCase() === "same as fronts"
        )
          return false;
        return !o.choices.some(
          (c) => String(c).toLowerCase() === String(x).toLowerCase(),
        );
      })
    )
      errors[o.name] = "Choose a supported value.";
    if (o.min != null && vals.some((x) => Number(x) < o.min))
      errors[o.name] = `Must be at least ${o.min}.`;
    if (o.max != null && vals.some((x) => Number(x) > o.max))
      errors[o.name] = `Must be at most ${o.max}.`;
  }
  const skipRaw = Array.isArray(settings.skip)
    ? settings.skip
    : String(settings.skip || "")
        .split(/[ ,]+/)
        .filter(Boolean);
  if (skipRaw.some((x) => !/^\d+$/.test(String(x))))
    errors.skip =
      "Enter zero-based whole-number positions separated by commas.";
  for (const n of ["front_dir_path", "back_dir_path", "double_sided_dir_path"])
    if (allowed.has(n) && !settings[n]) errors[n] = "Select a source folder.";
  if (allowed.has("output_path") && !settings.output_path)
    errors.output_path = "Choose an output destination.";
  if (!settings.specialty && metadata.layouts?.length) {
    const supported = layoutCatalog.hasLayout(
      metadata, settings.card_size, settings.paper_size,
      settings.borderless ? "borderless" : "default",
    );
    if (!supported)
      errors.card_size =
        "This card and paper size combination is not available.";
  }
  return errors;
}

function toArgv(settings, metadata) {
  const argv = [];
  const options = new Map((metadata.options || []).map((o) => [o.name, o]));
  const inactive = inactiveOptions(settings);
  for (const [name, o] of options) {
    if (inactive.has(name)) continue;
    let value = settings[name];
    if (name === "skip") {
      const skips = [
        ...new Set(
          (Array.isArray(value) ? value : String(value || "").split(/[ ,]+/))
            .filter((x) => x !== "")
            .map(Number),
        ),
      ];
      for (const n of skips)
        if (Number.isInteger(n)) argv.push("--skip", String(n));
      continue;
    }
    if (
      name === "registration_orientation" &&
      String(value).toLowerCase() === "auto"
    )
      value = null;
    if (
      name === "fit_backs" &&
      String(value).toLowerCase() === "same as fronts"
    )
      value = null;
    if (
      ["crop", "crop_backs"].includes(name) &&
      typeof value === "string" &&
      value.trim().endsWith("%")
    )
      value = value.trim().slice(0, -1).trim();
    if (
      [
        "extend_edges",
        "extend_edges_backs",
        "extend_corners",
        "extend_corners_backs",
        "extend_bleed",
        "extend_bleed_backs",
      ].includes(name) &&
      typeof value === "string" &&
      value.trim().endsWith("px")
    )
      value = value.trim().slice(0, -2).trim();
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === false
    )
      continue;
    const flag = `--${name}`;
    if (o.is_flag) {
      if (value) argv.push(flag);
    } else if (Array.isArray(value))
      for (const v of value) argv.push(flag, String(v));
    else argv.push(flag, String(value));
  }
  return argv;
}

const api = { GROUPS, MANAGED_PATHS, defaults, validate, toArgv };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.pdfCreationSettings = api;
