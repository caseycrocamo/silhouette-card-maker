const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createJobActivity } = require('../GUI/Utilities/jobActivity');

test('update drain waits for queued jobs, blocks new work, and remains locked until resume', async () => {
  const activity = createJobActivity();
  let finish;
  const job = activity.run(() => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  let drained = false;
  const drain = activity.pauseAndDrain().then(() => { drained = true; });
  await assert.rejects(activity.run(() => assert.fail('must not start')), /restart is pending/);
  await Promise.resolve();
  assert.equal(drained, false);
  finish('done');
  assert.equal(await job, 'done');
  await drain;
  assert.equal(activity.isPaused(), true);
  activity.resume();
  assert.equal(await activity.run(() => 'resumed'), 'resumed');
});

test('failed jobs cancel drain and permit further work', async () => {
  const activity = createJobActivity();
  const job = activity.run(() => { throw new Error('PDF failed'); });
  const drain = activity.pauseAndDrain();
  await assert.rejects(job, /PDF failed/);
  await assert.rejects(drain, /job failed/);
  assert.equal(activity.isPaused(), false);
  assert.equal(await activity.run(() => 42), 42);
});

test('timed-out drain releases the gate without cancelling or killing active work', async () => {
  const activity = createJobActivity({ timeoutMs: 5 });
  let finish;
  const job = activity.run(() => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(activity.pauseAndDrain(), /Work is still running/);
  assert.equal(activity.isPaused(), false);
  finish('completed safely');
  assert.equal(await job, 'completed safely');
});

test('two simultaneous restart attempts cannot acquire the job gate', async () => {
  const activity = createJobActivity();
  await activity.pauseAndDrain();
  await assert.rejects(activity.pauseAndDrain(), /already pending/);
  activity.resume();
});
