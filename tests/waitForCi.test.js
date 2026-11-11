'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectRuns, REQUIRED } = require('../scripts/wait-for-ci');
const passing = () => REQUIRED.map((name, i) => ({ name, databaseId: i + 1, headBranch: 'main', status: 'completed', conclusion: 'success' }));

test('release waits for missing and running main checks', () => {
  assert.equal(inspectRuns([]).state, 'wait');
  const runs = passing(); runs[0].status = 'in_progress';
  assert.deepEqual(inspectRuns(runs), { state: 'wait', names: [REQUIRED[0]] });
});
test('tag and other branch checks cannot replace main CI', () => {
  assert.equal(inspectRuns(passing().map(run => ({ ...run, headBranch: 'v1.4.0' }))).state, 'wait');
});
for (const conclusion of ['failure', 'cancelled', 'timed_out']) test(`release rejects a ${conclusion} main check`, () => {
  const runs = passing(); runs[0].conclusion = conclusion;
  assert.deepEqual(inspectRuns(runs), { state: 'fail', names: [REQUIRED[0]] });
});
test('a newer rerun must pass before publishing', () => {
  const runs = passing(); runs.push({ ...runs[0], databaseId: 99, status: 'in_progress', conclusion: '' });
  assert.equal(inspectRuns(runs).state, 'wait');
  runs.at(-1).status = 'completed'; runs.at(-1).conclusion = 'success';
  assert.equal(inspectRuns(runs).state, 'pass');
});
test('optional platform checks block publication when present', () => {
  const runs = passing(); assert.equal(inspectRuns(runs).state, 'pass');
  runs.push({ name: 'PDF worker compatibility', databaseId: 99, headBranch: 'main', status: 'in_progress', conclusion: '' });
  assert.equal(inspectRuns(runs).state, 'wait');
  runs.at(-1).status = 'completed'; runs.at(-1).conclusion = 'failure';
  assert.equal(inspectRuns(runs).state, 'fail');
});
