"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createController } = require("../GUI/shared/cardList/controller");
const { createStore } = require("../GUI/shared/cardList/sessionStore");
const { exportImages } = require("../GUI/shared/cardList/imageExport");
const { createAdapter } = require("../GUI/CardList/adapters/pokemon");
const entry = {
  id: "1",
  name: "Pikachu",
  qty: 2,
  setCode: "SVI",
  number: "047",
};
const printing = {
  name: "Pikachu",
  setCode: "SVI",
  number: "047",
  faces: [{ url: "file:///cache.png" }],
};
test("retry preserves parse errors and cannot export an incomplete list", async () => {
  let fail = true;
  const c = createController({
    adapter: {
      parse: () => ({
        entries: [entry],
        errors: [{ line: 2, message: "Missing number" }],
      }),
      resolve: async () => {
        if (fail) throw Error("offline");
        return printing;
      },
      serialize: () => "",
    },
  });
  await c.search("bad list");
  fail = false;
  await c.search(c.state.draft, true);
  assert.equal(c.state.status, "error");
  assert.equal(c.state.errors.length, 1);
  assert.equal(c.canExport(), false);
});
test("input edit invalidates an in-flight search", async () => {
  let finish;
  const c = createController({
    adapter: {
      parse: () => ({ entries: [entry] }),
      resolve: () => new Promise((r) => (finish = r)),
      serialize: () => "",
    },
  });
  const pending = c.search("old");
  await new Promise((r) => setImmediate(r));
  c.dirty("new");
  finish(printing);
  await pending;
  assert.equal(c.state.draft, "new");
  assert.equal(c.state.status, "dirty");
  assert.equal(c.state.entries.length, 0);
});
test("search resolves repeated exact entries once", async () => {
  let count = 0;
  const c = createController({
    adapter: {
      parse: () => ({ entries: [entry, { ...entry, id: "2" }] }),
      resolve: async () => {
        count++;
        return printing;
      },
      serialize: () => "",
    },
  });
  await c.search("list");
  assert.equal(count, 1);
});
test("session drafts and workflow are game-scoped, including clearing", () => {
  const data = new Map([
    ["mtg-decklist", "Bolt"],
    ["cardWorkflow", "double_sided"],
  ]);
  const storage = {
    getItem: (k) => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
  };
  const mtg = createStore(storage, "mtg"),
    pokemon = createStore(storage, "pokemon");
  assert.equal(mtg.load().draft, "Bolt");
  pokemon.save("Pika", "front_only");
  mtg.save("", "double_sided");
  assert.equal(mtg.load().draft, "");
  assert.equal(pokemon.load().draft, "Pika");
  assert.equal(pokemon.load().workflow, "front_only");
});
test("Pokemon adapter delegates parsing and preserves exact collector number", async () => {
  const calls = [];
  const adapter = createAdapter(async (r) => {
    calls.push(r);
    return r.op === "parse" ? { entries: [entry] } : printing;
  });
  const parsed = await adapter.parse("2 Pikachu SVI 047");
  const resolved = await adapter.resolve(parsed.entries[0]);
  assert.equal(calls[1].entry.number, "047");
  assert.equal(
    adapter.serialize([{ ...entry, printing: resolved }]),
    "2 Pikachu SVI 047",
  );
  assert.equal(
    adapter.exportPlan([{ ...entry, printing: resolved }]).length,
    2,
  );
});
function dirs(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "card-test-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const frontDir = path.join(root, "front"),
    doubleSidedDir = path.join(root, "double");
  fs.mkdirSync(frontDir);
  fs.mkdirSync(doubleSidedDir);
  return { root, frontDir, doubleSidedDir };
}
test("replace stages every image before removing existing cards", async (t) => {
  const d = dirs(t);
  fs.writeFileSync(path.join(d.frontDir, "old.webp"), "old");
  await assert.rejects(
    exportImages({
      ...d,
      mode: "replace",
      plan: [
        { name: "one", front: {} },
        { name: "two", front: {} },
      ],
      loadImage: async () => {
        throw Error("offline");
      },
    }),
    /offline/,
  );
  assert.equal(
    fs.readFileSync(path.join(d.frontDir, "old.webp"), "utf8"),
    "old",
  );
});
test("replace writes paired names, preserves back folder and non-images", async (t) => {
  const d = dirs(t);
  fs.writeFileSync(path.join(d.frontDir, "old.WEBP"), "old");
  fs.writeFileSync(path.join(d.frontDir, "README.md"), "keep");
  const result = await exportImages({
    ...d,
    mode: "replace",
    plan: [{ name: "../../unsafe", front: {}, back: {} }],
    loadImage: async () => Buffer.from("png"),
  });
  assert.equal(result.files, 2);
  const names = fs.readdirSync(d.frontDir).filter((n) => n.endsWith(".png"));
  assert.equal(names.length, 1);
  assert.ok(fs.existsSync(path.join(d.doubleSidedDir, names[0])));
  assert.ok(fs.existsSync(path.join(d.frontDir, "README.md")));
  assert.ok(!fs.existsSync(path.join(d.frontDir, "old.WEBP")));
});
test("add creates distinct files and cancel leaves output unchanged", async (t) => {
  const d = dirs(t);
  const options = {
    ...d,
    plan: [{ name: "duplicate", front: {} }],
    loadImage: async () => Buffer.from("png"),
  };
  await exportImages(options);
  await exportImages(options);
  assert.equal(fs.readdirSync(d.frontDir).length, 2);
  await exportImages({ ...options, mode: "cancel" });
  assert.equal(fs.readdirSync(d.frontDir).length, 2);
});

test("legacy cached MTG cards migrate to a fresh resolvable draft", () => {
  const cache = [
    {
      name: "Lightning Bolt",
      qty: 3,
      selectedSetCode: "B",
      selectedSetNumber: "2",
    },
  ];
  const store = createStore(
    { getItem: (key) => (key === "mtg-cards" ? JSON.stringify(cache) : null) },
    "mtg",
  );
  assert.equal(store.load().draft, "3x Lightning Bolt (B) 2");
});
test("commit failure rolls back new files and restores replaced images", async (t) => {
  const d = dirs(t);
  fs.writeFileSync(path.join(d.frontDir, "old.jpg"), "old");
  fs.writeFileSync(path.join(d.doubleSidedDir, "old.png"), "back");
  let copies = 0;
  const fileSystem = {
    ...fs,
    copyFileSync(...args) {
      if (++copies === 2) throw Error("disk full");
      return fs.copyFileSync(...args);
    },
  };
  await assert.rejects(
    exportImages({
      ...d,
      fileSystem,
      mode: "replace",
      plan: [
        { name: "one", front: {} },
        { name: "two", front: {} },
      ],
      loadImage: async () => Buffer.from("new"),
    }),
    /disk full/,
  );
  assert.deepEqual(fs.readdirSync(d.frontDir), ["old.jpg"]);
  assert.equal(
    fs.readFileSync(path.join(d.frontDir, "old.jpg"), "utf8"),
    "old",
  );
  assert.equal(
    fs.readFileSync(path.join(d.doubleSidedDir, "old.png"), "utf8"),
    "back",
  );
  assert.deepEqual(fs.readdirSync(d.root).sort(), ["double", "front"]);
});

test('imported cards with the same name keep distinct art and paired backs', async () => {
  const cards = ['first', 'second'].map(id => ({
    id, name: 'Shared name', qty: 1,
    printing: { id, faces: [{ url: `file:///${id}.png` }], back: { url: `file:///${id}-back.png` } },
  }));
  const controller = createController({ adapter: {
    parse: () => ({ entries: cards, errors: [] }), resolve: item => item.printing,
    serialize: () => 'original source',
  } });
  await controller.search('original source');
  assert.equal(controller.state.entries[0].printing.id, 'first');
  assert.equal(controller.state.entries[1].printing.id, 'second');
  assert.equal(controller.state.entries[1].printing.back.url, 'file:///second-back.png');
});

test('game-scoped drafts migrate when format-scoped storage is introduced', () => {
  const data = new Map([['card-list:v1:pokemon', JSON.stringify({ draft: '2 Pikachu SVI 047', workflow: 'front_only' })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const store = createStore(storage, 'pokemon');
  assert.equal(store.load().draft, '2 Pikachu SVI 047');
  store.save('', 'front_only');
  assert.equal(store.load().draft, '');
});
