const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../GUI/MagicTheGathering/decklist.js'), 'utf8');

class Element {
    constructor(id = '') {
        this.id = id;
        this.listeners = {};
        this.children = [];
        this.style = {};
        this.classList = { add() {}, remove() {} };
        this.value = '';
        this.textContent = '';
        this.innerText = '';
        this.options = [];
        this.parentElement = null;
    }

    addEventListener(type, listener) {
        (this.listeners[type] ||= []).push(listener);
    }

    async emit(type, event = {}) {
        for (const listener of this.listeners[type] || []) {
            await listener.call(this, { preventDefault() {}, stopPropagation() {}, target: this, ...event });
        }
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        if (child.id) this.ownerDocument.elements.set(child.id, child);
        if (this.tagName === 'SELECT' && child.tagName === 'OPTION' && child.selected) this.value = child.value;
        return child;
    }

    focus() {}
    getBoundingClientRect() { return { bottom: 0, left: 0 }; }
    contains() { return false; }
    dispatchEvent() {}

    set innerHTML(value) {
        this._innerHTML = value;
        const ids = [...value.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
        for (const id of ids) this.ownerDocument.ensure(id);
        for (const [, id, src] of value.matchAll(/<img\b[^>]*\bid="([^"]+)"[^>]*\bsrc="([^"]*)"/g)) {
            this.ownerDocument.getElementById(id).src = src;
        }
        for (const [, id, text] of value.matchAll(/<span\b[^>]*\bid="card-set-(\d+)"[^>]*>(.*?)<\/span>/gs)) {
            this.ownerDocument.getElementById(`card-set-${id}`).textContent = text;
        }
    }

    get innerHTML() { return this._innerHTML || ''; }
}

class Document {
    constructor() {
        this.elements = new Map();
        this.workflow = [new Element(), new Element()];
        this.workflow[0].value = 'front_only';
        this.workflow[1].value = 'double_sided';
        this.body = new Element('body');
        this.body.ownerDocument = this;
        for (const id of ['longText', 'output', 'longForm', 'nextCreatePdfBtn', 'exportBtn']) this.ensure(id);
    }

    ensure(id) {
        if (!this.elements.has(id)) {
            const element = new Element(id);
            element.ownerDocument = this;
            this.elements.set(id, element);
        }
        return this.elements.get(id);
    }

    getElementById(id) { return this.ensure(id); }
    createElement(tagName) { const el = new Element(); el.tagName = tagName.toUpperCase(); el.ownerDocument = this; return el; }
    querySelectorAll(selector) { return selector === 'input[name="cardWorkflow"]' ? this.workflow : []; }
    querySelector(selector) { return selector === 'input[name="cardWorkflow"]:checked' ? this.workflow.find(item => item.checked) : null; }
    addEventListener() {}
}

function card(name, set, collectorNumber) {
    return {
        name,
        set,
        set_name: `${set.toUpperCase()} Set`,
        collector_number: collectorNumber,
        prints_search_uri: `prints:${name}`,
        image_uris: { png: `image:${set}:${name}` },
        layout: 'normal',
    };
}

async function createPage(decklist, { failSet = null, deferredSets = [] } = {}) {
    const document = new Document();
    document.getElementById('longText').value = decklist;
    const storage = new Map();
    const writtenFiles = [];
    const pendingFetches = new Map();
    const sessionStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
    };
    const setsByName = new Map();
    const context = {
        document,
        window: {
            addEventListener() {},
            require(name) {
                if (name === 'fs') return {
                    existsSync: () => false,
                    mkdirSync() {},
                    readdirSync: () => [],
                    writeFileSync: (file, buffer) => writtenFiles.push({ file, buffer }),
                };
                return require(name);
            },
        },
        sessionStorage,
        location: {},
        console: { log() {}, error() {} },
        alert() {},
        confirm: () => false,
        MouseEvent: class {},
        fetch: async url => {
            if (url.startsWith('prints:')) {
                const name = url.slice('prints:'.length);
                return { json: async () => ({ data: setsByName.get(name) || [] }) };
            }
            const match = url.match(/\/cards\/([a-z0-9]+)\/([^/?]+)/i);
            if (match) {
                const set = match[1].toLowerCase();
                const number = match[2];
                if (set === failSet) return { ok: false, status: 404 };
                const name = [...setsByName.keys()].find(key => setsByName.get(key).some(item => item.set === set));
                return { ok: true, json: async () => card(name, set, number) };
            }
            if (url.startsWith('image:')) {
                return { arrayBuffer: async () => Buffer.from(url) };
            }
            const named = new URL(url).searchParams;
            const name = decodeURIComponent(named.get('fuzzy'));
            const set = named.get('set') || 'a';
            if (deferredSets.includes(set)) {
                return new Promise(resolve => pendingFetches.set(set, () => resolve({
                    ok: true,
                    json: async () => card(name, set, set === 'a' ? '1' : `${set.charCodeAt(0) - 96}`),
                })));
            }
            if (set === failSet) return { ok: false, status: 404 };
            return { ok: true, json: async () => card(name, set, set === 'a' ? '1' : '2') };
        },
        require: name => name === '../shared/constants'
            ? { getFrontDir: () => '/tmp/front', getDoubleSidedDir: () => '/tmp/double' }
            : require(name),
        Buffer,
        URL,
    };
    const names = [...decklist.matchAll(/(?:^|\n)(?:\d+x?\s+)?(.+?)(?:\s+\([^)]+\))?(?:\s+\d+)?$/gm)].map(match => match[1].trim());
    for (const name of new Set(names)) setsByName.set(name, [card(name, 'a', '1'), card(name, 'b', '2'), card(name, 'c', '3')]);
    vm.runInNewContext(source, context, { filename: 'decklist.js' });
    context.window.onload();
    await document.getElementById('longForm').emit('submit');
    await new Promise(resolve => setImmediate(resolve));
    return {
        document,
        storage,
        writtenFiles,
        resolveFetch(set) {
            assert.ok(pendingFetches.has(set), `a pending lookup exists for set ${set}`);
            pendingFetches.get(set)();
            pendingFetches.delete(set);
        },
        inspect: () => vm.runInNewContext('cards.map(card => ({...card}))', context),
        async change(row, set) {
            let dropdown;
            for (let attempt = 0; attempt < 10; attempt++) {
                dropdown = document.elements.get(`set-select-${row}`);
                if (dropdown?.listeners.change?.length) break;
                await new Promise(resolve => setImmediate(resolve));
            }
            assert.ok(dropdown, `row ${row} has a printing dropdown`);
            assert.ok(dropdown.listeners.change?.length, `row ${row} printing dropdown is ready`);
            dropdown.value = set;
            await dropdown.emit('change');
        },
    };
}

test('switching a printing repeatedly updates that card and leaves other cards alone', async () => {
    const page = await createPage('Lightning Bolt\nCounterspell');
    const before = page.inspect();
    assert.equal(before.length, 2);

    await page.change(0, 'b');
    await page.change(0, 'a');
    await page.change(0, 'b');

    const after = page.inspect();
    assert.equal(after.length, before.length, 'printing changes must not create deck entries');
    assert.equal(after[0].selectedSetCode, 'B');
    assert.equal(after[0].selectedSetNumber, '2');
    assert.equal(after[1].name, 'Counterspell');
    assert.equal(after[1].selectedSetCode, 'A');
    assert.equal(after[1].selectedSetNumber, '1');
    assert.equal(page.document.getElementById('longText').value, 'Lightning Bolt (B) 2\nCounterspell (A) 1');
});

test('switching a multi-copy printing preserves the entered quantity and card count', async () => {
    const page = await createPage('3x Lightning Bolt');
    const before = page.inspect();
    const quantityBefore = before.reduce((total, item) => total + item.qty, 0);
    assert.equal(before.length, 1);
    assert.equal(quantityBefore, 3);

    await page.change(0, 'b');
    await page.change(0, 'a');
    await page.change(0, 'b');

    const after = page.inspect();
    assert.equal(after.length, 1);
    assert.equal(after.reduce((total, item) => total + item.qty, 0), quantityBefore);
    assert.equal(after[0].selectedSetCode, 'B');
    assert.equal(page.document.getElementById('longText').value, '3x Lightning Bolt (B) 2');
});

test('printing changes survive a decklist resubmit without multiplying quantity', async () => {
    const page = await createPage('3x Lightning Bolt');
    await page.change(0, 'b');
    const switchedText = page.document.getElementById('longText').value;

    await page.document.getElementById('longForm').emit('submit');

    const after = page.inspect();
    assert.equal(after.length, 1);
    assert.equal(after[0].qty, 3);
    assert.equal(after[0].selectedSetCode, 'B');
    assert.equal(after[0].selectedSetNumber, '2');
    assert.equal(page.document.getElementById('longText').value, switchedText);
});

test('a failed printing lookup leaves the current printing and quantity intact', async () => {
    const page = await createPage('2x Lightning Bolt', { failSet: 'b' });
    const before = page.inspect()[0];

    await page.change(0, 'b');

    const after = page.inspect();
    assert.equal(after.length, 1);
    assert.equal(after[0].qty, 2);
    assert.equal(after[0].selectedSetCode, before.selectedSetCode);
    assert.equal(after[0].selectedSetNumber, before.selectedSetNumber);
    assert.deepEqual(after[0].cardData, before.cardData);
    assert.equal(page.document.getElementById('set-select-0').value, 'a');
    assert.match(page.document.getElementById('set-error-0').textContent, /Unable to load/i);
    assert.equal(page.document.getElementById('longText').value, '2x Lightning Bolt (A) 1');
});

test('a slower old printing lookup cannot overwrite the latest choice', async () => {
    const page = await createPage('Lightning Bolt', { deferredSets: ['b', 'c'] });
    const dropdown = page.document.getElementById('set-select-0');

    dropdown.value = 'b';
    const oldRequest = dropdown.emit('change');
    dropdown.value = 'c';
    const latestRequest = dropdown.emit('change');
    page.resolveFetch('c');
    await latestRequest;
    page.resolveFetch('b');
    await oldRequest;

    const after = page.inspect();
    assert.equal(after.length, 1);
    assert.equal(after[0].selectedSetCode, 'C');
    assert.equal(after[0].selectedSetNumber, '3');
    assert.equal(page.document.getElementById('set-select-0').value, 'c');
    assert.equal(page.document.getElementById('card-img-0').src, 'image:c:Lightning Bolt');
});

test('a lookup for a removed card cannot change a newly submitted decklist row', async () => {
    const page = await createPage('Lightning Bolt', { deferredSets: ['b'] });
    const oldDropdown = page.document.getElementById('set-select-0');
    oldDropdown.value = 'b';
    const oldRequest = oldDropdown.emit('change');

    page.document.getElementById('longText').value = 'Counterspell';
    await page.document.getElementById('longForm').emit('submit');
    page.resolveFetch('b');
    await oldRequest;

    const after = page.inspect();
    assert.equal(after.length, 1);
    assert.equal(after[0].name, 'Counterspell');
    assert.equal(after[0].selectedSetCode, 'A');
    assert.equal(page.document.getElementById('longText').value, 'Counterspell (A) 1');
    assert.equal(page.document.getElementById('card-img-0').src, 'image:a:Counterspell');
    assert.equal(page.document.getElementById('card-set-0').textContent, '[A]');
});

test('image export expands a multi-copy card to exactly its quantity', async () => {
    const page = await createPage('3x Lightning Bolt');
    await page.document.getElementById('nextCreatePdfBtn').emit('click');

    assert.equal(page.writtenFiles.length, 3);
    assert.deepEqual(page.writtenFiles.map(entry => entry.file), [
        '/tmp/front/1lightningBolt1.png',
        '/tmp/front/2lightningBolt1.png',
        '/tmp/front/3lightningBolt1.png',
    ]);
});
