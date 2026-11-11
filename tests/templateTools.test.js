"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../GUI/shared/layoutCatalog");
const settings = require("../GUI/shared/pdfCreationSettings");

test("runtime catalog accepts added layouts and retains removed drafts as invalid", () => {
  const draft = { card_size: "custom", paper_size: "A4", borderless: false };
  const next = { layouts: [{ card_size: "custom", paper_size: "a4", variants: [{ name: "default" }] }] };
  assert.equal(catalog.refreshMetadata(draft, next).invalidSelection, false);
  assert.equal(catalog.refreshMetadata(draft, { layouts: [] }).invalidSelection, true);
});

test("PDF validation rejects unavailable saved custom combinations", () => {
  const metadata = { options: [], layouts: [{ card_size: "poker", paper_size: "letter", variants: [{ name: "default" }] }] };
  const errors = settings.validate({ specialty: false, card_size: "custom", paper_size: "A4" }, metadata);
  assert.match(errors.card_size, /not available/);
});
