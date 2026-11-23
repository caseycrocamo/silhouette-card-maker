const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveDevPython, runDev } = require('../GUI/dev');

test('development selects the active environment, project environments, or system Python', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const executable = platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    const active = path.join('/active environment', executable);
    assert.equal(resolveDevPython({ platform, env: { VIRTUAL_ENV: '/active environment' }, exists: () => true }), active);
    for (const folder of ['venv', '.venv']) {
      const python = path.resolve(__dirname, '..', folder, executable);
      assert.equal(resolveDevPython({ platform, env: {}, exists: file => file === python }), python);
    }
    assert.equal(resolveDevPython({ platform, env: {}, exists: () => false }), platform === 'win32' ? 'python' : 'python3');
  }
});

test('development builds CSS and starts Electron with source workers without building binaries', () => {
  const calls = [];
  const env = { TEST_DEV: 'preserved' };
  const status = runDev({ env, launch: (...args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(status, 0);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][1][0], '-c');
  assert.match(calls[1][1][0], /tailwindcss/);
  assert.match(calls[2][1][0], /electron/);
  assert.equal(calls[2][2].env.SCM_DEV_PYTHON, calls[0][0]);
  assert.equal(calls[2][2].env.TEST_DEV, 'preserved');
  assert.equal(calls[2][2].cwd, path.resolve(__dirname, '../GUI'));
  assert.equal(env.SCM_DEV_PYTHON, undefined);
});

test('development stops when Python or CSS fails and returns Electron failures', () => {
  for (const failure of [0, 1, 2]) {
    let count = 0;
    const status = runDev({ launch: () => ({ status: count++ === failure ? 1 : 0 }) });
    assert.equal(status, 1);
    assert.equal(count, failure + 1);
  }
});
