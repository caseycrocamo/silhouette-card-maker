"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { games } = require("../GUI/shared/cardList/gameRegistry");
const { createStore } = require("../GUI/shared/cardList/sessionStore");
const { loadGameOptions, hasGameOptions, normalizeOptions, saveGameOptions } = require("../GUI/shared/gameOptions");
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test("MTG has a task choice while Pokemon can open directly", async () => {
  const request = () => { throw Error("Built-in games do not need the worker."); };
  assert.equal(hasGameOptions(await loadGameOptions(games.mtg, request)), true);
  assert.equal(hasGameOptions(await loadGameOptions(games.pokemon, request)), false);
});
test("game option defaults reject stale formats, sources, and unsupported back modes", () => {
  const game = { id: "sample", formats: [{ id: "text" }], sourceChoices: [{ id: "official" }],
    scenarioChoices: [], workflows: ["front_only"], defaultWorkflow: "double_sided" };
  assert.deepEqual(normalizeOptions(game, { format: "gone", source: "gone", workflow: "double_sided" }), {
    format: "text", source: "official", scenario: "", workflow: "front_only", localBackDir: "",
  });
});
test("confirming game options preserves drafts belonging to both formats", () => {
  const data = storage(), store = createStore(data, "ashes_reborn");
  store.save("first URL", "front_only", { format: "one", source: "first" });
  store.save("second URL", "front_only", { format: "two", source: "second" });
  saveGameOptions(data, { id: "ashes_reborn" }, { format: "one", source: "second", workflow: "front_only" });
  assert.equal(store.load().draft, "first URL");
  assert.equal(store.load().source, "second");
  assert.equal(store.load("two").draft, "second URL");
});

test("every game can load its options while the card worker is unavailable", () => {
  const unavailableWorker = () => { throw new Error("Worker must not start for options."); };
  for (const game of Object.values(games)) {
    const options = loadGameOptions(game, unavailableWorker);
    assert.ok(!options.then, 'Options should be available synchronously.');
    assert.ok(options.formats.length, game.id);
    assert.ok(options.workflows.length, game.id);
  }
});
