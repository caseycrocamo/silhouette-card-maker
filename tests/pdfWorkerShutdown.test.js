const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => assert.fail('Idle worker should exit gracefully without being killed');
  child.stdin.on('finish', () => setImmediate(() => {
    child.exitCode = 0;
    child.emit('exit', 0);
  }));
  const filename = path.resolve(__dirname, '../GUI/Utilities/pdfWorkerClient.js');
  const constants = new Proxy({}, { get: () => () => path.dirname(filename) });
  const context = {
    module: { exports: {} }, __dirname: path.dirname(filename), process,
    console, setTimeout, clearTimeout,
    require(name) {
      if (name === 'child_process') return { spawn: () => child };
      if (name === '../shared/constants') return constants;
      if (name === 'electron') return { app: { isPackaged: false } };
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  return { client: context.module.exports, child };
}

test('update shutdown refuses to interrupt active and queued PDF work', async () => {
  const { client, child } = fixture();
  const first = client.runCreatePdf([]);
  const second = client.runOffsetPdf({ pdfPath: 'sample.pdf' });
  child.stdout.write('{"ready":true}\n');
  await assert.rejects(client.stopPdfWorkerForUpdate(), /still running/);
  assert.equal(child.stdin.writableEnded, false);
  child.stdout.write('{"ok":true,"log":"first"}\n');
  await first;
  await assert.rejects(client.stopPdfWorkerForUpdate(), /still running/);
  child.stdout.write('{"ok":true,"log":"second"}\n');
  await second;
  await client.stopPdfWorkerForUpdate();
  assert.equal(child.exitCode, 0);
});

test('update shutdown waits for the idle worker to exit and handles no worker', async () => {
  const { client, child } = fixture();
  await client.stopPdfWorkerForUpdate();
  client.startPdfWorker();
  child.stdout.write('{"ready":true}\n');
  const stopped = client.stopPdfWorkerForUpdate();
  assert.equal(child.exitCode, null);
  await stopped;
  assert.equal(child.exitCode, 0);
});
