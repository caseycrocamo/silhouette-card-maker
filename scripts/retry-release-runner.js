'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

function isFirstReleaseFailure(run, repository) {
  return run.repository?.full_name === repository &&
    run.head_repository?.full_name === repository &&
    run.path === '.github/workflows/release.yml' &&
    run.event === 'push' &&
    /^v\d+\.\d+\.\d+$/.test(run.head_branch) &&
    run.run_attempt === 1 &&
    run.status === 'completed' &&
    ['failure', 'timed_out'].includes(run.conclusion);
}

function isUnassignedAppleSiliconJob(job) {
  return /^build \(macos-arm64, [^,]+, mac, arm64\)$/.test(job.name) &&
    job.status === 'completed' &&
    ['cancelled', 'failure', 'timed_out'].includes(job.conclusion) &&
    !job.runner_id && !job.runner_name && job.steps?.length === 0;
}

function ghApi(endpoint, method = 'GET') {
  const output = execFileSync('gh', ['api', '--method', method, endpoint], { encoding: 'utf8' });
  return output ? JSON.parse(output) : undefined;
}

function retryReleaseRunner(repository, run, api = ghApi) {
  if (!Number.isSafeInteger(run?.id) || !isFirstReleaseFailure(run, repository)) {
    return 'The event is not a failed first attempt for a release tag.';
  }

  const repo = `repos/${repository}`;
  const runPath = `${repo}/actions/runs/${run.id}`;
  const { jobs } = api(`${runPath}/attempts/1/jobs?per_page=100`);
  const unfinished = jobs.filter(job => job.conclusion !== 'success' &&
    !(job.name === 'publish' && job.conclusion === 'skipped'));
  if (unfinished.length !== 1 || !isUnassignedAppleSiliconJob(unfinished[0])) {
    return 'The sole failure is not an unassigned Apple Silicon build.';
  }

  const job = unfinished[0];
  const annotations = api(`${repo}/check-runs/${job.id}/annotations?per_page=100`);
  const noRunner = annotations.some(annotation => annotation.annotation_level === 'failure' &&
    /^The job was not acquired by Runner of type hosted even after multiple attempts\.?$/i.test(annotation.message));
  if (!noRunner) return 'GitHub did not report a hosted runner allocation failure.';

  const tag = encodeURIComponent(`refs/tags/${run.head_branch}`);
  if (api(`${repo}/commits/${tag}`).sha !== run.head_sha) return 'The release tag moved after the build.';

  // A maintainer may already have restarted this run since the event was queued.
  const latest = api(runPath);
  if (!isFirstReleaseFailure(latest, repository)) return 'The run is no longer a failed first attempt.';

  api(`${repo}/actions/jobs/${job.id}/rerun`, 'POST');
  return `Requested one retry of Apple Silicon job ${job.id} for ${run.head_branch}.`;
}

if (require.main === module) {
  const { workflow_run: run } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  console.log(retryReleaseRunner(process.env.GITHUB_REPOSITORY, run));
}

module.exports = { retryReleaseRunner };
