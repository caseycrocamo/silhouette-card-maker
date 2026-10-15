'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function makeIpc(initialState = {}) {
  const listeners = new Map();
  const calls = [];
  return {
    calls,
    listenerCount(channel) { return (listeners.get(channel) || []).length; },
    on(channel, listener) { listeners.set(channel, [...(listeners.get(channel) || []), listener]); },
    removeListener(channel, listener) { listeners.set(channel, (listeners.get(channel) || []).filter(item => item !== listener)); },
    emit(channel, value) { for (const listener of listeners.get(channel) || []) listener({}, value); },
    async invoke(channel, ...args) {
      calls.push([channel, ...args]);
      if (channel === 'updates:get-state') return initialState;
      if (channel === 'read-offset-data') return { x_offset: 0, y_offset: 0 };
      if (channel === 'get-default-calibration-pdf') return '';
      return undefined;
    }
  };
}

function loadUpdateControls(ipc) {
  const window = {
    listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    __silhouetteUpdateControls: undefined
  };
  const context = {
    window,
    console,
    require(name) { assert.equal(name, 'electron'); return { ipcRenderer: ipc }; },
    module: { exports: {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'GUI/shared/updateControls.js'), 'utf8'), context, { filename: 'updateControls.js' });
  return { api: context.module.exports, window };
}

function makeElement() {
  return {
    textContent: '', innerHTML: '', checked: false, disabled: false, hidden: false,
    value: '', handlers: {}, children: [],
    addEventListener(name, callback) { this.handlers[name] = callback; },
    replaceChildren(...children) { this.children = children; },
    appendChild(child) { this.children.push(child); },
    setAttribute() {},
    classList: { add() {}, remove() {} }
  };
}

async function loadSettings(state, customizeControls) {
  const ipc = makeIpc(state);
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); },
    createElement() { return makeElement(); }
  };
  const window = { handlers: {}, addEventListener(name, callback) { this.handlers[name] = callback; } };
  const updateControls = loadUpdateControls(ipc).api;
  if (customizeControls) customizeControls(updateControls);
  const context = {
    window, document, console: { error() {} }, location: { href: '' },
    require(name) {
      if (name === 'electron') return { ipcRenderer: ipc };
      if (name === 'path') return path;
      if (path.normalize(name).endsWith(path.join('shared', 'updateControls.js'))) return updateControls;
      assert.fail(`Unexpected require: ${name}`);
    },
    __dirname: path.join(root, 'GUI/Settings'),
    module: { exports: {} }
  };
  // Reuse the production singleton exactly as a node-enabled renderer does.
  context.window.__silhouetteUpdateControls = updateControls;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'GUI/Settings/settings.js'), 'utf8'), context, { filename: 'settings.js' });
  window.handlers.DOMContentLoaded();
  await new Promise(resolve => setImmediate(resolve));
  return { elements, ipc, window, updateControls };
}

test('shared update controls keep one state listener, refresh snapshots, and clean up', async () => {
  const initial = { status: 'idle', currentVersion: '1.2.3' };
  const ipc = makeIpc(initial);
  const { api, window } = loadUpdateControls(ipc);
  let observed;
  const unsubscribe = api.subscribe(state => { observed = state; });

  await api.refresh();
  assert.equal(observed.currentVersion, '1.2.3');
  assert.equal(ipc.listenerCount('updates:state'), 1);
  assert.equal(ipc.calls.filter(call => call[0] === 'updates:get-state').length, 1);
  ipc.emit('updates:state', { status: 'available', availableVersion: '1.3.0' });
  assert.equal(observed.availableVersion, '1.3.0');

  unsubscribe();
  window.listeners.beforeunload();
  assert.equal(ipc.listenerCount('updates:state'), 0);
  assert.equal(window.__silhouetteUpdateControls, undefined);
});

test('Settings renders update state as text and reflects error and disabled controls', async () => {
  const notes = '<img src=x onerror=alert(1)>\nRelease notes';
  const state = {
    status: 'error', currentVersion: '1.2.3', automaticChecks: true,
    lastCheckedAt: '2026-02-03T04:05:06.000Z', releaseNotes: notes,
    error: 'Could not reach the release server.', enabled: false
  };
  const { elements } = await loadSettings(state);
  assert.equal(elements.get('updateCurrentVersion').textContent, '1.2.3');
  assert.equal(elements.get('updateReleaseNotes').textContent, notes);
  assert.equal(elements.get('updateReleaseNotes').innerHTML, '');
  assert.equal(elements.get('updateError').textContent, state.error);
  assert.equal(elements.get('updateError').hidden, false);
  assert.equal(elements.get('automaticUpdateChecks').checked, true);
  assert.equal(elements.get('automaticUpdateChecks').disabled, true);
  assert.equal(elements.get('checkUpdatesBtn').disabled, true);
});

test('Settings disables manual check while a check is already running', async () => {
  const { elements } = await loadSettings({ status: 'checking', currentVersion: '1.2.3', enabled: true });
  assert.equal(elements.get('checkUpdatesBtn').disabled, true);
  assert.equal(elements.get('automaticUpdateChecks').disabled, false);
});

test('Settings shows progress and exposes rejected update actions to the user', async () => {
  const { elements, updateControls } = await loadSettings({
    status: 'downloading', currentVersion: '1.2.3', enabled: true, progress: 42
  });
  assert.equal(elements.get('updateProgress').hidden, false);
  assert.equal(elements.get('updateProgress').value, 42);

  const failed = await loadSettings(
    { status: 'error', currentVersion: '1.2.3', enabled: true, error: 'Network error' },
    controls => { controls.openRelease = async () => { throw new Error('Release page could not open.'); }; }
  );
  const action = failed.elements.get('updateActions').children[0];
  await action.handlers.click();
  assert.equal(failed.elements.get('updateError').hidden, false);
  assert.equal(failed.elements.get('updateError').textContent, 'Release page could not open.');
});

test('navbar and Settings classic scripts load in one renderer lexical scope', () => {
  const ipc = makeIpc({ status: 'idle', enabled: true });
  const window = { addEventListener() {} };
  const customElements = { define() {} };
  class HTMLElement {}
  const context = {
    window, customElements, HTMLElement, console, document: {},
    require(name) {
      if (name === 'path') return path;
      if (path.normalize(name).endsWith(path.join('shared', 'updateControls.js'))) return loadUpdateControls(ipc).api;
      if (name === 'electron') return { ipcRenderer: ipc };
      assert.fail(`Unexpected require: ${name}`);
    },
    __dirname: path.join(root, 'GUI/Settings'), module: { exports: {} }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'GUI/shared/navbar.js'), 'utf8'), context, { filename: 'navbar.js' });
  assert.doesNotThrow(() => vm.runInContext(fs.readFileSync(path.join(root, 'GUI/Settings/settings.js'), 'utf8'), context, { filename: 'settings.js' }));
});
