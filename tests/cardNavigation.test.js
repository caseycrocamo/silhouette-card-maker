'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function render(url, saved, initialStep = '2') {
  let Navbar;
  class Element {
    constructor() { this.attributes = { 'current-step': initialStep }; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    querySelector() { return null; }
  }
  const context = {
    HTMLElement: Element, window: { location: new URL(url) },
    sessionStorage: { getItem: () => saved }, URLSearchParams,
    __dirname: path.resolve(__dirname, '../GUI/shared'),
    require: name => name === 'path' ? path : name.endsWith('gameRegistry.js') ? require('../GUI/shared/cardList/gameRegistry') : {},
    customElements: { define: (_name, klass) => { Navbar = klass; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../GUI/shared/navbar.js'), 'utf8'), context);
  const nav = new Navbar();
  nav.updateActiveState();
  nav.updateContent();
  return nav.innerHTML;
}

test('direct valid card-list game takes precedence over saved navigation game', () => {
  assert.match(render('file:///GUI/CardList/decklist.html?game=pokemon', 'mtg'), /decklist.html\?game=pokemon/);
  assert.match(render('file:///GUI/CardList/decklist.html?game=mtg', 'pokemon'), /decklist.html\?game=mtg/);
});

test('translation returns to MTG while PDF retains selected game', () => {
  assert.match(render('file:///GUI/MagicTheGathering/text_translation.html', 'pokemon'), /decklist.html\?game=mtg/);
  assert.match(render('file:///GUI/CreatePDF/create.html', 'pokemon'), /decklist.html\?game=pokemon/);
});

test('plugin navigation keeps the selected game and rejects unknown IDs', () => {
  assert.match(render('file:///GUI/CardList/decklist.html?game=lorcana', 'mtg'), /decklist.html\?game=lorcana/);
  assert.match(render('file:///GUI/CreatePDF/create.html', 'riftbound'), /decklist.html\?game=riftbound/);
  for (const query of ['unknown', '__proto__', '']) {
    assert.match(render(`file:///GUI/CardList/decklist.html?game=${query}`, 'pokemon'), /decklist.html\?game=pokemon/);
  }
  assert.match(render('file:///GUI/CardList/decklist.html?game=unknown', 'unknown'), /decklist.html\?game=mtg/);
  assert.match(render('file:///GUI/CreatePDF/create.html', null), /decklist.html\?game=mtg/);
});

test('process routes show one current step and badges only on earlier steps', () => {
  const routes = ['Home/home.html', 'CardList/decklist.html', 'CreatePDF/create.html'];
  for (const [index, route] of routes.entries()) {
    const html = render(`file:///GUI/${route}`, 'mtg', '4');
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1, route);
    assert.equal((html.match(/class="navbar-completion-badge"/g) || []).length, index, route);
    assert.match(html, /<ol\b/);
    assert.match(html, /Choose Game/);
    assert.match(html, /Card List/);
    assert.match(html, /Create PDF/);
    assert.doesNotMatch(html, /group-hover|opacity-0/);
  }
  const translation = render('file:///GUI/MagicTheGathering/text_translation.html', 'pokemon', '1');
  assert.equal((translation.match(/class="navbar-completion-badge"/g) || []).length, 1);
});

test('utility routes show neutral process steps and the correct current utility', () => {
  for (const [route, destination] of [['Settings/settings.html', '../Settings/settings.html'], ['Tools/tools.html', '../Tools/tools.html']]) {
    const html = render(`file:///GUI/${route}`, 'pokemon', '4');
    assert.doesNotMatch(html, /aria-current="step"|class="navbar-completion-badge"/);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    const anchor = html.match(new RegExp(`<a[^>]*href="${destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`));
    assert.ok(anchor, route);
    assert.match(anchor[0], /aria-current="page"/);
    assert.match(html, /aria-label="Cutting templates"/);
  }
});
