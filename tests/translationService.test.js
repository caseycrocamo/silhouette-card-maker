'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createTranslationService } = require('../GUI/Utilities/translationService');

function fixture(t, behavior = 'success', packaged = false, platform = process.platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-é-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const python = path.join(root, 'venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, '');
  fs.writeFileSync(path.join(root, 'translated_text_boxes_to_pdf.py'), '');
  const calls = [];
  const service = createTranslationService({ fs: behavior === 'rename' ? { ...fs, promises: { ...fs.promises, rename: async () => { throw new Error('fixture destination is locked'); } } } : fs, app: { isPackaged: packaged }, projectRoot: root, platform,
    resourcesPath: path.join(root, 'resources'), temporaryRoot: root,
    getOutputDir: () => path.join(root, 'output'), getLayoutEnvironment: () => ({ SCM_EXTRA_LAYOUTS: path.join(root, 'custom.json') }),
    spawn(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setImmediate(() => {
        if (behavior === 'spawn') { child.emit('error', new Error('fixture spawn failure')); return; }
        const destination = args[args.indexOf('--output_path') + 1];
        if (behavior === 'partialfailure') { fs.writeFileSync(destination, '%PDF-partial'); child.stderr.write('fixture late failure'); child.emit('close', 2); return; }
        if (behavior === 'failure') { child.stderr.write('fixture conversion failed'); child.emit('close', 2); return; }
        if (behavior !== 'missing') fs.writeFileSync(destination, behavior === 'invalid' ? '%PDF-truncated' : '%PDF-fixture\n%%EOF\n');
        child.stdout.write('Created PDF'); child.emit('close', 0);
      });
      return child;
    }
  });
  return { root, service, calls };
}

test('translation preserves quality zero, explicit path, editor text and custom layout environment', async t => {
  const { root, service, calls } = fixture(t);
  const source = path.join(root, 'source-é.md'); fs.writeFileSync(source, 'original');
  const outputPath = path.join(root, '出力', 'chosen.pdf');
  const response = await service.run({ markdownText: 'edited {W}', outputPath, paperSize: 'custom', quality: 0, ppi: 72 });
  assert.equal(response.outputPath, outputPath); assert.equal(response.log, 'Created PDF');
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  const call = calls[0];
  assert.equal(call.args[call.args.indexOf('--quality') + 1], '0');
  assert.equal(call.options.env.SCM_EXTRA_LAYOUTS, path.join(root, 'custom.json'));
  assert.equal(call.options.shell, false);
  assert.equal(fs.existsSync(call.args[call.args.indexOf('--input_path') + 1]), false);
});

test('two translation jobs use separate temporary input paths and defaults', async t => {
  const { service, calls } = fixture(t);
  await service.run({ markdownText: 'first' });
  await service.run({ markdownText: 'second', quality: 100 });
  const input = call => call.args[call.args.indexOf('--input_path') + 1];
  assert.notEqual(input(calls[0]), input(calls[1]));
  assert(calls.every(call => !fs.existsSync(path.dirname(input(call)))));
  assert.equal(calls[0].args[calls[0].args.indexOf('--ppi') + 1], '300');
  assert.equal(calls[0].args[calls[0].args.indexOf('--quality') + 1], '75');
});

for (const behavior of ['failure', 'spawn', 'missing']) test(`translation cleans temporary input after ${behavior}`, async t => {
  const { service, calls } = fixture(t, behavior);
  await assert.rejects(service.run({ markdownText: 'text' }));
  const input = calls[0].args[calls[0].args.indexOf('--input_path') + 1];
  assert.equal(fs.existsSync(path.dirname(input)), false);
});

test('translation rejects malformed values before launch', async t => {
  const { service, calls } = fixture(t);
  for (const values of [{ markdownText: ' ' }, { ppi: 0 }, { ppi: 1.5 }, { ppi: '72' }, { quality: -1 }, { quality: 101 }, { quality: false }, { outputPath: 'relative.pdf' }, { outputPath: '/tmp/file.png' }, { paperSize: '' }]) {
    await assert.rejects(service.run({ markdownText: 'text', ...values }));
  }
  assert.equal(calls.length, 0);
});

test('packaged translation never falls back to installed Python', async t => {
  const { service, calls } = fixture(t, 'success', true);
  await assert.rejects(service.run({ markdownText: 'text' }), /executable is missing/);
  assert.equal(calls.length, 0);
});

for (const behavior of ['partialfailure', 'invalid', 'missing', 'spawn', 'rename']) test(`translation preserves an existing PDF after ${behavior}`, async t => {
  const { root, service, calls } = fixture(t, behavior);
  const outputPath = path.join(root, 'prior-é.pdf');
  const original = Buffer.from('%PDF-original document\n%%EOF\n');
  fs.writeFileSync(outputPath, original);
  await assert.rejects(service.run({ markdownText: 'replacement text', outputPath }));
  assert.deepEqual(fs.readFileSync(outputPath), original);
  const staged = calls[0].args[calls[0].args.indexOf('--output_path') + 1];
  assert.notEqual(staged, outputPath);
  assert.equal(fs.existsSync(path.dirname(staged)), false);
});

test('translation atomically replaces an existing PDF only after successful validation', async t => {
  const { root, service, calls } = fixture(t);
  const outputPath = path.join(root, 'chosen.pdf');
  fs.writeFileSync(outputPath, 'previous content');
  const result = await service.run({ markdownText: 'replacement', outputPath });
  assert.equal(result.outputPath, outputPath);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), '%PDF-fixture\n%%EOF\n');
  const staged = calls[0].args[calls[0].args.indexOf('--output_path') + 1];
  assert.notEqual(staged, outputPath);
  assert.equal(path.dirname(path.dirname(staged)), path.dirname(outputPath));
  assert.equal(fs.existsSync(path.dirname(staged)), false);
});

for (const platform of ['win32', 'darwin', 'linux']) test(`translation resolves the project Python on ${platform}`, async t => {
  const { root, service, calls } = fixture(t, 'success', false, platform);
  await service.run({ markdownText: 'Fixture card' });
  assert.equal(calls[0].command, path.join(root, 'venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
  assert.equal(calls[0].args[0], path.join(root, 'translated_text_boxes_to_pdf.py'));
});
