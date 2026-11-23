const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

function resolveDevPython({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const executable = platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  const candidates = [
    env.VIRTUAL_ENV && path.join(env.VIRTUAL_ENV, executable),
    ...['venv', '.venv'].map(folder => path.join(projectRoot, folder, executable))
  ].filter(Boolean);
  return candidates.find(candidate => exists(candidate)) || (platform === 'win32' ? 'python' : 'python3');
}

function runDev({ launch = spawnSync, env = process.env } = {}) {
  const python = resolveDevPython({ env });
  const options = { cwd: __dirname, stdio: 'inherit', env };
  const check = launch(python, ['-c', 'import sys; sys.exit(0)'], options);
  if (check.error || check.status !== 0) {
    console.error('Cannot start Python. Create a Python environment and install requirements.txt.');
    return 1;
  }
  const css = launch(process.execPath, [require.resolve('tailwindcss/lib/cli'), '-i', './styles/tailwind.css', '-o', './styles/main.css'], options);
  if (css.error || css.status !== 0) return css.status || 1;
  // Use current Python sources even when GUI/bin contains an older build.
  const electron = launch(process.execPath, [require.resolve('electron/cli'), '.'], {
    ...options, env: { ...env, SCM_DEV_PYTHON: python }
  });
  if (electron.error) console.error(electron.error.message);
  return electron.status ?? 1;
}

module.exports = { resolveDevPython, runDev };
if (require.main === module) process.exitCode = runDev();
