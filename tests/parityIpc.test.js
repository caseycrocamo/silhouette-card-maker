'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { isTrustedUpdateSender } = require('../GUI/Utilities/updateIpc');

function event(url = pathToFileURL(path.resolve(__dirname, '../GUI/Tools/tools.html')).href) {
  const sender = new EventEmitter();
  const mainFrame = { url };
  sender.mainFrame = mainFrame;
  sender.dead = false;
  sender.isDestroyed = () => sender.dead;
  sender.messages = [];
  sender.send = (...args) => sender.messages.push(args);
  return { sender, senderFrame: mainFrame };
}

function fixture(t) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-ipc-é-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const handlers = new Map(), calls = [];
  let openResult = { canceled: true, filePaths: [] }, saveResult = { canceled: true };
  let capabilities = { ok: true, result: { paper_sizes: [{ name: 'custom' }] } };
  let finish, fail, emit;
  let active = 0;
  const studio = {
    getCapabilities() { calls.push(['studio-capabilities']); return { supported: true }; },
    startStudioJob(request, onEvent) { calls.push(['studio-start', request]); emit = onEvent; return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); },
    replyStudioPrompt(request) { calls.push(['studio-reply', request]); return { accepted: true }; },
    stopStudioJob() { calls.push(['studio-stop']); return { stopping: true }; },
  };
  const filename = path.resolve(__dirname, '../GUI/Utilities/parityIpc.js');
  const context = { Buffer, module: { exports: {} }, require(name) {
    if (name === './studioClient') return studio;
    if (name === './translationService') return { createTranslationService(options) {
      calls.push(['translation-create', options]);
      return { run(request) { calls.push(['translation-run', request]); return { outputPath: path.join(work, 'chosen.pdf'), log: 'done' }; } };
    } };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  context.module.exports.registerParityIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    app: { isPackaged: false },
    dialog: {
      async showOpenDialog(options) { calls.push(['open', options]); return openResult; },
      async showSaveDialog(options) { calls.push(['save', options]); return saveResult; },
    },
    trustedFeatureSender(value) {
      if (!isTrustedUpdateSender(value, path.resolve(__dirname, '../GUI'))) throw new Error('Untrusted caller');
    },
    jobActivity: { run(callback) { active++; return Promise.resolve().then(callback).finally(() => { active--; }); } },
    getPdfCapabilities: async () => capabilities,
    getOutputDir: () => work,
    getLayoutEnvironment: () => ({ SCM_EXTRA_LAYOUTS: path.join(work, 'custom.json') }),
  });
  return { work, calls, handlers,
    invoke: (channel, value = event(), ...args) => Promise.resolve().then(() => handlers.get(channel)(value, ...args)),
    setOpen: value => { openResult = value; }, setSave: value => { saveResult = value; },
    setCapabilities: value => { capabilities = value; },
    finish: value => finish(value), fail: error => fail(error), emit: value => emit(value), active: () => active,
  };
}

test('all parity commands reject remote callers before any dialog, job, or process', async t => {
  const f = fixture(t);
  for (const channel of f.handlers.keys()) {
    await assert.rejects(f.invoke(channel, event('https://example.com'), {}), /Untrusted caller/);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.active(), 0);
});

test('translation capabilities return runtime papers and default path; failures are reported', async t => {
  const f = fixture(t);
  const response = await f.invoke('get-translation-capabilities');
  assert.equal(response.paper_sizes[0].name, 'custom');
  assert.equal(response.defaultOutputPath, path.join(f.work, 'translatedTextBoxes.pdf'));
  f.setCapabilities({ ok: false, error: 'worker stopped' });
  await assert.rejects(f.invoke('get-translation-capabilities'), /worker stopped/);
  assert.equal(f.active(), 0);
});

test('translation runs through activity gate with exact options and lazy shared service', async t => {
  const f = fixture(t), request = { markdownText: 'edited text', paperSize: 'custom', quality: 0, ppi: 72, outputPath: path.join(f.work, 'chosen.pdf') };
  const response = await f.invoke('run-md-to-pdf', event(), request);
  assert.equal(response.outputPath, request.outputPath);
  assert.equal(f.calls.find(call => call[0] === 'translation-run')[1], request);
  await f.invoke('run-md-to-pdf', event(), request);
  assert.equal(f.calls.filter(call => call[0] === 'translation-create').length, 1);
  assert.equal(f.active(), 0);
});

test('Markdown open returns Unicode source text, preserves it, and handles cancellation', async t => {
  const f = fixture(t);
  assert.equal(await f.invoke('open-translation-markdown'), null);
  const source = path.join(f.work, '原稿-é.md'), text = '### Card {W}\n\nDraw a card.';
  fs.writeFileSync(source, text);
  f.setOpen({ canceled: false, filePaths: [source] });
  const result = await f.invoke('open-translation-markdown');
  assert.equal(result.path, source); assert.equal(result.text, text);
  assert.equal(fs.readFileSync(source, 'utf8'), text);
});

test('Markdown open rejects oversized files, directories, and oversized decoded content', async t => {
  const f = fixture(t), source = path.join(f.work, 'large.md');
  f.setOpen({ canceled: false, filePaths: [source] });
  fs.writeFileSync(source, Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(f.invoke('open-translation-markdown'), /smaller than 2 MB/);
  fs.writeFileSync(source, Buffer.alloc(1024 * 1024, 0x80));
  await assert.rejects(f.invoke('open-translation-markdown'), /too large/);
  f.setOpen({ canceled: false, filePaths: [f.work] });
  await assert.rejects(f.invoke('open-translation-markdown'), /smaller than 2 MB/);
});

test('translation save dialog preserves cancellation and selected absolute output', async t => {
  const f = fixture(t), selected = path.join(f.work, '出力.pdf');
  assert.equal(await f.invoke('select-translation-output', event(), { defaultPath: selected }), null);
  assert.equal(f.calls.at(-1)[1].defaultPath, selected);
  f.setSave({ canceled: false, filePath: selected });
  assert.equal(await f.invoke('select-translation-output'), selected);
  assert.equal(f.calls.at(-1)[1].defaultPath, path.join(f.work, 'translatedTextBoxes.pdf'));
});

test('Studio holds ownership/activity, forwards events, rejects concurrent jobs and foreign controls', async t => {
  const f = fixture(t), owner = event(), other = event(), request = { command: 'convert', input: '/tmp/card.dxf' };
  const running = f.invoke('studio-start', owner, request);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.active(), 1);
  await assert.rejects(f.invoke('studio-start', other, request), /already running/);
  await assert.rejects(f.invoke('studio-stop', other), /another window/);
  await assert.rejects(f.invoke('studio-reply', other, { value: 'yes' }), /another window/);
  const update = { type: 'progress', completed: 1 };
  f.emit(update);
  assert.deepEqual(owner.sender.messages, [['studio-event', update]]);
  assert.equal((await f.invoke('studio-reply', owner, { value: 'yes' })).accepted, true);
  assert.equal((await f.invoke('studio-stop', owner)).stopping, true);
  f.finish({ ok: true });
  assert.equal((await running).ok, true);
  assert.equal(f.active(), 0);
  assert.equal(owner.sender.listenerCount('destroyed'), 0);
  assert.equal(owner.sender.listenerCount('did-start-navigation'), 0);
});

test('Studio navigation and destruction stop jobs; dead windows receive no events; failure releases owner', async t => {
  const f = fixture(t), owner = event();
  const running = f.invoke('studio-start', owner, { command: 'calibrate' });
  await new Promise(resolve => setImmediate(resolve));
  owner.sender.emit('did-start-navigation');
  owner.sender.dead = true; owner.sender.emit('destroyed');
  f.emit({ type: 'prompt', id: 1 });
  assert.equal(owner.sender.messages.length, 0);
  assert.equal(f.calls.filter(call => call[0] === 'studio-stop').length, 2);
  f.fail(new Error('worker crashed'));
  await assert.rejects(running, /worker crashed/);
  assert.equal(f.active(), 0);
  assert.equal(owner.sender.listenerCount('destroyed'), 0);
  assert.equal(owner.sender.listenerCount('did-start-navigation'), 0);
  const next = f.invoke('studio-start', event(), { command: 'dry-run' });
  await new Promise(resolve => setImmediate(resolve));
  f.finish({ ok: true });
  assert.equal((await next).ok, true);
});

test('Studio capability and path dialogs use correct modes and reject unknown kinds', async t => {
  const f = fixture(t);
  assert.equal((await f.invoke('studio-capabilities')).supported, true);
  for (const kind of ['dxf', 'directory', 'executable', 'calibration-input']) {
    f.setOpen({ canceled: false, filePaths: [path.join(f.work, 'selected')] });
    assert.equal(await f.invoke('studio-select-path', event(), { kind }), path.join(f.work, 'selected'));
    assert.equal(f.calls.at(-1)[1].properties[0], kind === 'directory' ? 'openDirectory' : 'openFile');
    if (kind === 'calibration-input') assert.deepEqual(Array.from(f.calls.at(-1)[1].filters[0].extensions), ['json']);
  }
  for (const kind of ['studio3', 'calibration']) {
    const selected = path.join(f.work, kind);
    f.setSave({ canceled: false, filePath: selected });
    assert.equal(await f.invoke('studio-select-path', event(), { kind }), selected);
    assert.equal(f.calls.at(-1)[1].filters[0].extensions[0], kind === 'studio3' ? 'studio3' : 'json');
  }
  f.setOpen({ canceled: true });
  assert.equal(await f.invoke('studio-select-path', event(), { kind: 'dxf' }), null);
  await assert.rejects(f.invoke('studio-select-path', event(), { kind: 'shell' }), /Invalid Studio path kind/);
});
