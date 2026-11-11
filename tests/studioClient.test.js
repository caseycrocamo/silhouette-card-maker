'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const Module = require('node:module');
// The client capability path is independent from Electron and does not spawn.
const original = Module._load;
Module._load = function(name, parent, ...rest) {
  if (name === '../shared/constants' && parent.filename.endsWith('studioClient.js')) return { getLayoutEnvironment: () => ({ SCM_EXTRA_LAYOUTS: '/custom.json' }) };
  return original.call(this, name, parent, ...rest);
};
const { createStudioClient } = require('../GUI/Utilities/studioClient');
Module._load = original;
function fixture(options = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.pid = 123; child.exitCode = null; child.signalCode = null;
  child.kill = () => { child.signalCode = 'SIGKILL'; child.emit('close', null, 'SIGKILL'); };
  const writes = [], spawns = [];
  child.stdin.on('data', chunk => { writes.push(...chunk.toString().trim().split('\n').filter(Boolean).map(JSON.parse)); });
  const spawn = (...args) => { spawns.push(args); return child; };
  const client = createStudioClient({ platform: 'win32', app: { isPackaged: false }, exists: () => false,
    spawn, stopTimeout: 15, startupTimeout: 1000, ...options });
  const event = value => child.stdout.write(JSON.stringify(value) + '\n');
  const exit = code => { child.exitCode = code; child.emit('close', code, null); };
  return { child, client, writes, spawns, event, exit };
}

test('unsupported hosts show manual instructions without starting a process', async () => {
  const client = createStudioClient({ platform: 'darwin', spawn: () => { throw new Error('must not spawn'); } });
  assert.equal(client.getCapabilities().supported, false);
  assert.equal(client.getCapabilities().defaultStudioPath, String.raw`C:\Program Files\Silhouette America\Silhouette Studio\Silhouette Studio.exe`);
  await assert.rejects(client.startStudioJob({}), /requires Windows/);
});

test('worker uses array arguments, sends Unicode request after ready, and streams events', async () => {
  const f = fixture(), events = [];
  const result = f.client.startStudioJob({ inputPath: 'C:\\資料\\cards.dxf', operation: 'single' }, e => events.push(e));
  assert.equal(f.spawns[0][2].shell, false);
  assert(Array.isArray(f.spawns[0][1]));
  assert.equal(f.spawns[0][2].env.SCM_EXTRA_LAYOUTS, '/custom.json');
  assert.equal(f.writes.length, 0);
  f.event({ event: 'ready', supported: true });
  assert.equal(f.writes[0].request.inputPath, 'C:\\資料\\cards.dxf');
  f.event({ event: 'progress', completed: 1, total: 1 });
  f.event({ event: 'result', ok: true, result: { completed: 1 } });
  // Result alone must not unlock concurrent automation before child exit.
  await assert.rejects(f.client.startStudioJob({}), /already active/);
  f.exit(0);
  assert.deepEqual(await result, { completed: 1 });
  assert(events.some(e => e.event === 'progress'));
});

test('prompt replies require the active prompt identity and reject repeats', async () => {
  const f = fixture(), result = f.client.startStudioJob({ operation: 'calibrate' });
  f.event({ event: 'ready', supported: true });
  f.event({ event: 'prompt', promptId: 'p1', kind: 'element' });
  assert.throws(() => f.client.replyStudioPrompt({ promptId: 'old', value: 'record' }), /no longer active/);
  f.client.replyStudioPrompt({ promptId: 'p1', value: 'skip' });
  assert.deepEqual(f.writes[1], { command: 'reply', promptId: 'p1', value: 'skip' });
  assert.throws(() => f.client.replyStudioPrompt({ promptId: 'p1', value: 'record' }), /no longer active/);
  f.event({ event: 'result', ok: true, result: { elements: 2 } }); f.exit(0); await result;
});

test('unexpected exit rejects the job and permits a fresh run', async () => {
  const f = fixture(), result = f.client.startStudioJob({});
  f.child.stderr.write('fixture crash'); f.exit(2);
  await assert.rejects(result, /fixture crash/);
  const second = f.client.startStudioJob({});
  f.event({ event: 'ready', supported: true });
  f.event({ event: 'result', ok: true, result: { dryRun: true } }); f.exit(0);
  await second;
});

test('stop sends structured cancellation and waits for worker cleanup', async () => {
  const f = fixture(), result = f.client.startStudioJob({});
  f.event({ event: 'ready', supported: true });
  const stopped = f.client.stopStudioJob();
  assert.equal(f.writes.at(-1).command, 'stop');
  f.event({ event: 'result', ok: true, result: { canceled: true } }); f.exit(0);
  assert.equal((await stopped).stopped, true);
  assert.equal((await result).canceled, true);
});

test('bounded stop uses Windows process-tree termination', async () => {
  const f = fixture(), result = f.client.startStudioJob({});
  f.event({ event: 'ready', supported: true });
  await f.client.shutdownStudioClient();
  const kill = f.spawns.find(call => call[0] === 'taskkill');
  assert.deepEqual(kill[1], ['/pid', '123', '/t', '/f']);
  assert.equal(kill[2].shell, false);
  assert.equal((await result).forced, true);
});

test('invalid protocol output rejects and stops the child', async () => {
  const f = fixture(), result = f.client.startStudioJob({});
  f.child.stdout.write('not json\n');
  await assert.rejects(result, /invalid JSON/);
});
