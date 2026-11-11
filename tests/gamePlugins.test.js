"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { games } = require("../GUI/shared/cardList/gameRegistry");
const { createStore } = require("../GUI/shared/cardList/sessionStore");

test("all twenty game plugins have formats and unique routes", () => {
  const ids = Object.keys(games).filter((id) => !["mtg", "pokemon"].includes(id));
  assert.equal(ids.length, 20);
  for (const id of ids) assert.ok(games[id].formats.length, id);
});

test("plugin drafts remain isolated by game", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  createStore(storage, "altered").save("first", "front_only");
  createStore(storage, "digimon").save("second", "front_only");
  assert.equal(createStore(storage, "altered").load().draft, "first");
  assert.equal(createStore(storage, "digimon").load().draft, "second");
});

test("plugin drafts and options remain isolated by format", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const store = createStore(storage, "ashes_reborn");
  store.save("first format URL", "front_only", { format: "ashes_share_url", source: "ashes" });
  store.save("second format URL", "front_only", { format: "ashesdb_share_url", source: "ashesdb" });
  assert.equal(store.load("ashes_share_url").draft, "first format URL");
  assert.equal(store.load("ashes_share_url").source, "ashes");
  assert.equal(store.load("ashesdb_share_url").draft, "second format URL");
  assert.equal(store.load("ashesdb_share_url").source, "ashesdb");
});

test('file retry keeps its selected source and replaces results without multiplying copies', async () => {
  const { createAdapter } = require('../GUI/CardList/adapters/plugin');
  const { createController } = require('../GUI/shared/cardList/controller');
  let picks = 0, imports = 0;
  const game = { id: 'yugioh', formats: [{ id: 'ydk', inputKind: 'file' }] };
  const adapter = createAdapter(game, async request => {
    assert.equal(request.input.value, '/tmp/デッキ.ydk');
    return { entries: [{ id: String(++imports), name: 'Card', qty: 3, faces: [{ url: 'file:///front.png' }] }],
      errors: imports === 1 ? [{ message: 'One card failed' }] : [] };
  }, { input: async () => { picks++; return { kind: 'file', value: '/tmp/デッキ.ydk' }; } });
  const controller = createController({ adapter });
  await controller.search('');
  assert.equal(controller.state.status, 'partial');
  await controller.search(controller.state.draft, true);
  assert.equal(picks, 1);
  assert.equal(controller.state.entries.length, 1);
  assert.equal(adapter.exportPlan(controller.state.entries).length, 3);
  adapter.clearSource();
  await controller.search(controller.state.draft);
  assert.equal(picks, 2);
});
