'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retryReleaseRunner } = require('../scripts/retry-release-runner');

const repository = 'owner/project';
const run = {
  id: 123,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  path: '.github/workflows/release.yml',
  event: 'push',
  head_branch: 'v1.5.0',
  head_sha: 'a'.repeat(40),
  run_attempt: 1,
  status: 'completed',
  conclusion: 'failure',
};
const macJob = {
  id: 456,
  name: 'build (macos-arm64, macos-15, mac, arm64)',
  status: 'completed',
  conclusion: 'cancelled',
  runner_id: 0,
  runner_name: '',
  steps: [],
};
const otherJobs = [
  { name: 'build (windows-x64, windows-latest, win, x64)', conclusion: 'success' },
  { name: 'publish', conclusion: 'skipped' },
];
const allocationFailure = {
  annotation_level: 'failure',
  message: 'The job was not acquired by Runner of type hosted even after multiple attempts',
};

function checkRetry({ event = run, latest = run, jobs = [...otherJobs, macJob],
  annotations = [allocationFailure], tagSha = run.head_sha } = {}) {
  const repo = `repos/${repository}`;
  const runPath = `${repo}/actions/runs/${run.id}`;
  const responses = new Map([
    [`${runPath}/attempts/1/jobs?per_page=100`, { jobs }],
    [`${repo}/check-runs/${macJob.id}/annotations?per_page=100`, annotations],
    [`${repo}/commits/refs%2Ftags%2Fv1.5.0`, { sha: tagSha }],
    [runPath, latest],
  ]);
  const posted = [];
  const message = retryReleaseRunner(repository, event, (endpoint, method) => {
    if (method === 'POST') {
      posted.push(endpoint);
      return;
    }
    assert.ok(responses.has(endpoint), `Unexpected read: ${endpoint}`);
    return responses.get(endpoint);
  });
  return { posted, message };
}

test('a hosted runner allocation failure retries only the Apple Silicon job', () => {
  const { posted } = checkRetry();
  assert.deepEqual(posted, [`repos/${repository}/actions/jobs/456/rerun`]);
});

test('a failed build, capacity notice, or second failed job does not trigger a retry', () => {
  for (const options of [
    { jobs: [...otherJobs, { ...macJob, runner_id: 22, conclusion: 'timed_out' }] },
    { jobs: [...otherJobs, { ...macJob, steps: [{ name: 'Build installers' }] }] },
    { annotations: [{ ...allocationFailure, annotation_level: 'notice' }] },
    { jobs: [...otherJobs, macJob, { name: 'build (linux-x64)', conclusion: 'failure' }] },
  ]) {
    assert.deepEqual(checkRetry(options).posted, []);
  }
});

test('manual cancellations, dispatches, other workflows, and reruns are ignored', () => {
  for (const event of [
    { ...run, conclusion: 'cancelled' },
    { ...run, event: 'workflow_dispatch' },
    { ...run, path: '.github/workflows/other.yml' },
    { ...run, head_branch: 'main' },
    { ...run, run_attempt: 2 },
    { ...run, head_repository: { full_name: 'other/project' } },
  ]) {
    assert.deepEqual(checkRetry({ event }).posted, []);
  }
});

test('a moved tag or a run already restarted by a maintainer is ignored', () => {
  assert.deepEqual(checkRetry({ tagSha: 'b'.repeat(40) }).posted, []);
  assert.deepEqual(checkRetry({ latest: { ...run, run_attempt: 2 } }).posted, []);
});
