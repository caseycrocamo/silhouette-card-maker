'use strict';
const { execFileSync } = require('node:child_process');

const REQUIRED = ['Run Tests (PR & Push)', 'Isolated integration tests', 'Spell Check', 'Check links in Hugo site'];
const OPTIONAL = ['PDF worker compatibility', 'Build and deploy Hugo site'];

function inspectRuns(runs) {
  const main = runs.filter(run => run.headBranch === 'main').sort((a, b) => b.databaseId - a.databaseId);
  const names = [...REQUIRED, ...OPTIONAL.filter(name => main.some(run => run.name === name))];
  const selected = names.map(name => ({ name, run: main.find(run => run.name === name) }));
  const failed = selected.filter(({ run }) => run && run.status === 'completed' && run.conclusion !== 'success');
  if (failed.length) return { state: 'fail', names: failed.map(item => item.name) };
  const waiting = selected.filter(({ run }) => !run || run.status !== 'completed');
  return { state: waiting.length ? 'wait' : 'pass', names: waiting.map(item => item.name) };
}

async function waitForCi(sha, repo) {
  if (!/^[a-f0-9]{40}$/i.test(sha || '') || !repo) throw new Error('Provide a full commit SHA and GH_REPO.');
  for (let attempt = 0; attempt < 60; attempt++) {
    const output = execFileSync('gh', ['run', 'list', '--repo', repo, '--commit', sha, '--event', 'push', '--limit', '100',
      '--json', 'databaseId,name,status,conclusion,headBranch'], { encoding: 'utf8' });
    const result = inspectRuns(JSON.parse(output));
    if (result.state === 'pass') { console.log(`Main CI passed for ${sha}.`); return; }
    if (result.state === 'fail') throw new Error(`Main CI failed: ${result.names.join(', ')}`);
    console.log(`Waiting for main CI: ${result.names.join(', ')}`);
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  throw new Error('Main CI did not finish successfully within 30 minutes.');
}

if (require.main === module) waitForCi(process.argv[2], process.env.GH_REPO).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = { inspectRuns, REQUIRED };
