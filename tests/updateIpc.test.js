const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isTrustedUpdateSender, registerUpdateIpc } = require('../GUI/Utilities/updateIpc');
const guiRoot = path.resolve(__dirname, '../GUI');

function trustedEvent() {
  const frame = { url: pathToFileURL(path.join(guiRoot, 'Settings/settings.html')).href };
  return { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
}

test('update commands reject remote pages, subframes, and files outside the GUI', () => {
  assert.equal(isTrustedUpdateSender(trustedEvent(), guiRoot), true);
  for (const url of ['https://example.com', pathToFileURL(path.join(guiRoot, '../README.md')).href, 'not a url']) {
    const event = trustedEvent();
    event.senderFrame.url = url;
    assert.equal(isTrustedUpdateSender(event, guiRoot), false);
  }
  const event = trustedEvent();
  event.senderFrame = { url: event.sender.mainFrame.url };
  assert.equal(isTrustedUpdateSender(event, guiRoot), false);
});

test('update IPC validates payloads, broadcasts state, and unregisters cleanly', () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) };
  const service = new EventEmitter();
  const snapshot = { status: 'available' };
  service.getState = () => snapshot;
  service.setAutomaticChecks = enabled => enabled;
  const messages = [];
  const BrowserWindow = { fromWebContents: () => ({}), getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => messages.push(args) } }] };
  const cleanup = registerUpdateIpc({ ipcMain, BrowserWindow, service, guiRoot });
  const event = trustedEvent();
  assert.equal(handlers.get('updates:get-state')(event), snapshot);
  assert.equal(handlers.get('updates:set-automatic')(event, false), false);
  assert.throws(() => handlers.get('updates:set-automatic')(event, 'false'), /true or false/);
  assert.throws(() => handlers.get('updates:download')(event, 'https://bad.example/update.exe'), /Invalid update command/);
  const remote = trustedEvent();
  remote.senderFrame.url = 'https://example.com';
  assert.throws(() => handlers.get('updates:install')(remote), /only available/);
  service.emit('state-changed', snapshot);
  assert.deepEqual(messages, [['updates:state', snapshot]]);
  cleanup();
  assert.equal(handlers.size, 0);
  assert.equal(service.listenerCount('state-changed'), 0);
});
