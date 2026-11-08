"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const api = require("../GUI/shared/pdfCreationSettings");

const names = [...api.GROUPS.page, ...api.GROUPS.image, ...api.GROUPS.file];
const metadata = {
  options: names.map((name) => ({
    name,
    default: [
      "only_fronts",
      "borderless",
      "load_offset",
      "show_outline",
      "output_images",
    ].includes(name)
      ? false
      : ["skip"].includes(name)
        ? []
        : [
              "label",
              "output_path",
              "specialty",
              "registration_orientation",
              "crop",
              "crop_backs",
            ].includes(name)
          ? null
          : ["ppi"].includes(name)
            ? 300
            : ["quality"].includes(name)
              ? 100
              : ["fit", "fit_backs", "registration"].includes(name)
                ? "stretch"
                : ["card_size"].includes(name)
                  ? "standard"
                  : ["paper_size"].includes(name)
                    ? "letter"
                    : "",
    is_flag: [
      "only_fronts",
      "borderless",
      "load_offset",
      "show_outline",
      "output_images",
    ].includes(name),
    multiple: name === "skip",
    min: name === "ppi" ? 1 : name === "quality" ? 0 : undefined,
    max: name === "quality" ? 100 : undefined,
    choices: ["fit", "fit_backs"].includes(name)
      ? ["stretch", "crop"]
      : undefined,
  })),
  card_sizes: [],
  paper_sizes: [],
  specialty_layouts: [],
};

test("GUI groups cover the creation contract and every option maps to argv", () => {
  assert.equal(new Set(names).size, names.length);
  assert.equal(metadata.options.length, names.length);
  for (const option of metadata.options) {
    const value = option.is_flag
      ? true
      : option.multiple
        ? [2]
        : option.name === "registration_orientation"
          ? "portrait"
          : option.name === "specialty"
            ? "mini"
            : (option.choices?.[0] ??
              (option.default === "" ? "value" : option.default) ??
              "value");
    const argv = api.toArgv(
      { ...api.defaults(metadata), [option.name]: value },
      metadata,
    );
    assert.ok(argv.includes(`--${option.name}`), `missing --${option.name}`);
  }
  const html = fs.readFileSync(
    require.resolve("../GUI/CreatePDF/create.html"),
    "utf8",
  );
  assert.deepEqual(
    [...html.matchAll(/data-category="(page|image|file)"/g)].map((x) => x[1]),
    ["page", "image", "file"],
  );
});

test("defaults and argv preserve absent values, zero, units, repeats, quotes, spaces and Unicode", () => {
  const d = api.defaults(metadata, {
    front_dir_path: "/cards with spaces/雪",
    output_path: "/managed/game.pdf",
  });
  assert.equal(d.ppi, 300);
  assert.equal(d.front_dir_path, "/cards with spaces/雪");
  assert.equal(d.output_path, "/managed/game.pdf");
  const argv = api.toArgv(
    {
      ...d,
      quality: 0,
      crop: "2%",
      label: '雪 "A" px',
      output_path: '/tmp/final file "x".pdf px',
      skip: [4, 4, 0],
    },
    metadata,
  );
  assert.deepEqual(
    argv.slice(argv.indexOf("--skip"), argv.indexOf("--skip") + 4),
    ["--skip", "4", "--skip", "0"],
  );
  assert.ok(argv.includes("--crop"));
  assert.ok(argv.includes("2"));
  assert.ok(argv.includes("0"));
  assert.ok(argv.includes('雪 "A" px'));
  assert.ok(argv.includes('/tmp/final file "x".pdf px'));
  assert.ok(!api.toArgv(d, metadata).includes("--label"));
});

test("unit normalization and optional orientation or generic back fit use CLI forms", () => {
  const settings = {
    ...api.defaults(metadata),
    crop: "8%",
    crop_backs: "2.5%",
    extend_edges: "12px",
    fit_backs: "same as fronts",
    registration_orientation: "auto",
  };
  const argv = api.toArgv(settings, metadata);
  assert.ok(argv.includes("8"));
  assert.ok(argv.includes("2.5"));
  assert.ok(argv.includes("12"));
  assert.ok(!argv.includes("--fit_backs"));
  assert.ok(!argv.includes("--registration_orientation"));
});

test("validation covers integers, ranges, skips, source paths and incompatible presets", () => {
  const base = api.defaults(metadata);
  assert.equal(
    api.validate(
      {
        ...base,
        ppi: "300",
        quality: "0",
        skip: "4, 4, 0",
        front_dir_path: "/front",
        back_dir_path: "/back",
        double_sided_dir_path: "/duplex",
      },
      metadata,
    ).ppi,
    undefined,
  );
  const errors = api.validate(
    {
      ...base,
      ppi: "3.5",
      quality: "101",
      skip: "4, nope",
      specialty: "mini",
      borderless: true,
    },
    metadata,
  );
  assert.ok(errors.ppi);
  assert.ok(errors.quality);
  assert.ok(errors.skip);
  assert.ok(errors.front_dir_path);
});

test("specialty geometry omits ordinary dimensions and borderless, then restores standard args", () => {
  const base = {
    ...api.defaults(metadata),
    card_size: "standard",
    paper_size: "letter",
    borderless: true,
  };
  const specialtyArgs = api.toArgv({ ...base, specialty: "mini" }, metadata);
  assert.ok(!specialtyArgs.includes("--card_size"));
  assert.ok(!specialtyArgs.includes("--paper_size"));
  assert.ok(!specialtyArgs.includes("--borderless"));
  const standardArgs = api.toArgv({ ...base, specialty: null }, metadata);
  assert.ok(standardArgs.includes("--card_size"));
  assert.ok(standardArgs.includes("--paper_size"));
  assert.ok(standardArgs.includes("--borderless"));
});

test('inactive backs and specialty geometry retain drafts without blocking or sending values', () => {
  const settings = {...api.defaults(metadata), only_fronts:true, fit_backs:'invalid retained value', crop_backs:'bad', specialty:'mini', borderless:true};
  const errors = api.validate(settings,metadata);
  assert.equal(errors.fit_backs,undefined);
  const argv = api.toArgv(settings,metadata);
  assert.equal(argv.includes('--fit_backs'),false);
  assert.equal(argv.includes('--crop_backs'),false);
  assert.equal(argv.includes('--borderless'),false);
  assert.equal(settings.crop_backs,'bad');
});

test('layout validation checks the selected variant, not only paper and card names', () => {
  const layouts=[{card_size:'standard',paper_size:'letter',variants:[{name:'default'}]}];
  const settings={...api.defaults(metadata), card_size:'standard', paper_size:'letter', borderless:true};
  assert.ok(api.validate(settings,{...metadata,layouts}).card_size);
  assert.equal(api.validate({...settings,borderless:false},{...metadata,layouts}).card_size,undefined);
});
