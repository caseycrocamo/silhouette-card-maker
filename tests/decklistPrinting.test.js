const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdapter } = require('../GUI/CardList/adapters/mtg');
const { createController } = require('../GUI/shared/cardList/controller');
const { createStore } = require('../GUI/shared/cardList/sessionStore');

function card(name, set = 'a', collectorNumber = '1', extra = {}) {
    return {
        id: `${name}:${set}:${collectorNumber}`, name, set,
        set_name: `${set.toUpperCase()} Set`, collector_number: collectorNumber,
        prints_search_uri: `https://api.scryfall.com/cards/search?q=${encodeURIComponent(name)}`,
        image_uris: { png: `https://cards.scryfall.io/${set}/${collectorNumber}/${encodeURIComponent(name)}.png` },
        layout: 'normal', ...extra,
    };
}

async function createPage(decklist) {
    const requests = [];
    const adapter = createAdapter(async url => {
        requests.push(url);
        const parsed = new URL(url);
        const exact = parsed.pathname.match(/^\/cards\/([^/]+)\/([^/]+)$/);
        const name = parsed.searchParams.get('fuzzy') || 'Lightning Bolt';
        return { ok: true, json: async () => card(name, exact?.[1] || parsed.searchParams.get('set') || 'a', exact?.[2] || '1') };
    });
    const storage = new Map();
    const store = createStore({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, 'mtg');
    const controller = createController({ adapter, onDraft: draft => store.save(draft, 'double_sided') });
    await controller.search(decklist);
    return {
        adapter, controller, store, requests,
        change(index, set, number = set === 'a' ? '1' : '2', extra = {}) {
            const entry = controller.state.entries[index];
            const previous = entry.printing;
            return controller.applyPrinting(entry, adapter.normalize(card(entry.name, set, number, extra)), previous);
        },
    };
}

test('switching a printing repeatedly updates only the original deck entry', async () => {
    const page = await createPage('Lightning Bolt\nCounterspell');
    const other = page.controller.state.entries[1];
    page.change(0, 'b'); page.change(0, 'a'); page.change(0, 'b');
    const entries = page.controller.state.entries;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].printing.setCode, 'B');
    assert.equal(entries[0].printing.number, '2');
    assert.equal(entries[1], other);
    assert.equal(entries[1].printing.setCode, 'A');
    assert.equal(page.controller.state.draft, 'Lightning Bolt (B) 2\nCounterspell (A) 1');
});

test('same-set variants retain exact collector number, art, and quantity in saved state', async () => {
    const page = await createPage('3x Lightning Bolt');
    page.change(0, 'a', '659', { border_color: 'borderless' });
    const entry = page.controller.state.entries[0];
    assert.equal(entry.qty, 3);
    assert.equal(entry.printing.number, '659');
    assert.equal(entry.printing.rawCard.border_color, 'borderless');
    assert.equal(entry.printing.faces[0].url, 'https://cards.scryfall.io/a/659/Lightning%20Bolt.png');
    assert.equal(page.store.load().draft, '3x Lightning Bolt (A) 659');
    assert.equal(page.store.load().workflow, 'double_sided');
});

test('printing changes survive resubmit without multiplying quantity', async () => {
    const page = await createPage('3x Lightning Bolt');
    page.change(0, 'b', '42');
    const text = page.controller.state.draft;
    await page.controller.search(text);
    assert.equal(page.controller.state.entries.length, 1);
    assert.equal(page.controller.state.entries[0].qty, 3);
    assert.equal(page.controller.state.entries[0].printing.number, '42');
    assert.equal(page.controller.state.draft, text);
    assert.match(page.requests.at(-1), /\/cards\/b\/42$/);
});

test('opening a draft without applying leaves printing and saved deck unchanged', async () => {
    const page = await createPage('2x Lightning Bolt');
    const entry = page.controller.state.entries[0];
    const before = entry.printing;
    const candidate = page.adapter.normalize(card(entry.name, 'b', '2'));
    assert.notEqual(candidate.id, before.id);
    assert.equal(entry.printing, before);
    assert.equal(page.store.load().draft, '2x Lightning Bolt (A) 1');
    assert.equal(page.controller.applyPrinting(entry, null, before), false);
    assert.equal(entry.printing, before);
});

test('a callback from an old printing choice cannot overwrite the latest choice', async () => {
    const page = await createPage('Lightning Bolt');
    const entry = page.controller.state.entries[0];
    const original = entry.printing;
    page.change(0, 'c', '3');
    assert.equal(page.controller.applyPrinting(entry, page.adapter.normalize(card(entry.name, 'b', '2')), original), false);
    assert.equal(entry.printing.setCode, 'C');
    assert.equal(entry.printing.number, '3');
});

test('a callback for a removed card cannot change a newly submitted row', async () => {
    const page = await createPage('Lightning Bolt');
    const removed = page.controller.state.entries[0];
    const original = removed.printing;
    await page.controller.search('Counterspell');
    assert.equal(page.controller.applyPrinting(removed, page.adapter.normalize(card('Lightning Bolt', 'b', '2')), original), false);
    assert.equal(page.controller.state.entries[0].name, 'Counterspell');
    assert.equal(page.controller.state.draft, 'Counterspell (A) 1');
});

test('manual edits invalidate pending printing choices', async () => {
    const page = await createPage('Lightning Bolt');
    const removed = page.controller.state.entries[0];
    page.controller.dirty('Counterspell');
    assert.equal(page.controller.applyPrinting(removed, page.adapter.normalize(card('Lightning Bolt', 'b', '2')), removed.printing), false);
    assert.equal(page.controller.state.draft, 'Counterspell');
    assert.equal(page.controller.canExport(), false);
});

test('image export expands a changed multi-copy printing to exactly its quantity', async () => {
    const page = await createPage('3x Lightning Bolt');
    page.change(0, 'b', '659');
    const plan = page.adapter.exportPlan(page.controller.state.entries, 'front_only');
    assert.equal(plan.length, 3);
    assert(plan.every(copy => copy.front.url === 'https://cards.scryfall.io/b/659/Lightning%20Bolt.png'));
    assert.equal(page.requests.length, 1, 'Printing commits use the exact loaded card without a second lookup');
});

test('two-faced printing changes export the new matching front and back', async () => {
    const page = await createPage('2x Lightning Bolt');
    const faces = [
        { name: 'Front', image_uris: { png: 'https://cards.scryfall.io/front.png' } },
        { name: 'Back', image_uris: { png: 'https://cards.scryfall.io/back.png' } },
    ];
    page.change(0, 'b', '9', { image_uris: undefined, layout: 'transform', card_faces: faces });
    const plan = page.adapter.exportPlan(page.controller.state.entries, 'double_sided');
    assert.equal(plan.length, 2);
    assert(plan.every(copy => copy.front.url.endsWith('/front.png') && copy.back.url.endsWith('/back.png')));
    assert.equal(page.controller.state.entries[0].printing.rawCard.card_faces, faces);
});
