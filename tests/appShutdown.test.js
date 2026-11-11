'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerAppShutdown } = require('../GUI/Utilities/appShutdown');

function appFixture() {
  const app = new EventEmitter();
  app.quitCalls = 0;
  app.events = [];
  app.quit = () => {
    app.quitCalls++;
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    app.events.push(event);
    app.emit('before-quit', event);
  };
  return app;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('quit waits for Studio input cleanup and permits only the guarded final quit', async () => {
  const app = appFixture(), studio = deferred();
  const stops = [], errors = [];
  let updateStops = 0;
  const lifecycle = registerAppShutdown({ app,
    beforeShutdown: () => { updateStops++; },
    shutdownTasks: [() => { stops.push('pdf'); }, () => { stops.push('studio'); return studio.promise; },
      () => { stops.push('card'); return Promise.resolve(); }],
    reportError: error => errors.push(error) });
  app.quit();
  await Promise.resolve();
  assert.equal(lifecycle.isQuitting(), true);
  assert.equal(app.events[0].prevented, true);
  assert.deepEqual(stops, ['pdf', 'studio', 'card']);
  assert.equal(app.quitCalls, 1, 'Electron must stay alive while Studio stop is pending');
  app.quit();
  assert.equal(app.events[1].prevented, true, 'Reentrant quit must remain blocked');
  assert.equal(updateStops, 1);
  studio.resolve();
  await lifecycle.whenFinished();
  assert.equal(app.quitCalls, 3, 'Cleanup triggers one final quit after the two user attempts');
  assert.equal(app.events[2].prevented, false);
  assert.deepEqual(stops, ['pdf', 'studio', 'card'], 'Each worker stop runs once');
  assert.deepEqual(errors, []);
});

test('one failing worker stop does not skip Studio cleanup or block the final quit', async () => {
  const app = appFixture(), studio = deferred(), errors = [];
  registerAppShutdown({ app, shutdownTasks: [() => { throw new Error('PDF stop failed'); }, () => studio.promise],
    reportError: error => errors.push(error.message) });
  app.quit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.quitCalls, 1);
  studio.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.quitCalls, 2);
  assert.equal(app.events[1].prevented, false);
  assert.deepEqual(errors, ['PDF stop failed']);
});

test('shutdown remains bounded if a worker stop never completes', async () => {
  const app = appFixture(), errors = [];
  const lifecycle = registerAppShutdown({ app, timeoutMs: 10,
    shutdownTasks: [() => new Promise(() => {})], reportError: error => errors.push(error.message) });
  app.quit();
  await lifecycle.whenFinished();
  assert.equal(app.quitCalls, 2);
  assert.equal(app.events[1].prevented, false);
  assert.match(errors[0], /time limit/);
});
