const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

function resolveCardWorker({ packaged, resourcesPath = process.resourcesPath, platform = process.platform } = {}) {
  const root = path.join(__dirname, '../..');
  const bin = path.join(packaged ? resourcesPath : path.join(root, 'GUI'), 'bin', platform === 'win32' ? 'card_worker.exe' : 'card_worker');
  if (packaged || fs.existsSync(bin)) return { command: bin, args: [], cwd: path.dirname(bin) };
  const candidates = ['.venv', 'venv'].map(dir => path.join(root, dir, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
  return { command: candidates.find(file => fs.existsSync(file)) || (platform === 'win32' ? 'python' : 'python3'), args: [path.join(root, 'card_worker.py')], cwd: root };
}

function createCardWorkerClient({ launch = spawn, resolve = () => resolveCardWorker({ packaged: require('electron').app.isPackaged }), env = null, timeoutMs = 120000 } = {}) {
  let worker = null, sequence = 0, reader = null;
  const pending = new Map();
  function fail(error, child = worker) {
    if (worker !== child) return;
    worker = null;
    reader?.close(); reader = null;
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); }
    pending.clear();
    child?.kill();
  }
  function start() {
    if (worker) return worker;
    const command = resolve();
    const child = launch(command.command, command.args, { cwd: command.cwd, env: env || { ...process.env, CARD_MAKER_CACHE_DIR: path.join(require('../shared/constants').getDataDir(), 'card-cache') }, shell: false, windowsHide: true });
    worker = child;
    reader = readline.createInterface({ input: child.stdout });
    reader.on('line', line => {
      let response;
      try { response = JSON.parse(line); } catch { fail(new Error('Invalid card worker response.'), child); return; }
      const task = pending.get(response.id);
      if (!task) return;
      pending.delete(response.id); clearTimeout(task.timer);
      if (response.ok === false || response.error) task.reject(new Error(response.error || 'Card request failed.'));
      else task.resolve(response.result || response);
    });
    child.stderr.on('data', () => {});
    child.on('error', error => fail(error, child));
    child.on('close', () => fail(new Error('Card worker stopped. Retry the request.'), child));
    return child;
  }
  function request(payload) {
    return new Promise((resolveTask, reject) => {
      let child;
      try { child = start(); } catch(error) { reject(error); return; }
      const id = ++sequence;
      const timer = setTimeout(() => fail(new Error('Card request timed out.'), child), timeoutMs);
      pending.set(id, { resolve: resolveTask, reject, timer });
      child.stdin.write(JSON.stringify({ ...payload, version: 1, id }) + '\n', error => { if (error) fail(error, child); });
    });
  }
  async function stop() {
    const child = worker;
    if (!child) return;
    await new Promise(resolveDone => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolveDone(); }, 2000);
      child.once('close', () => { clearTimeout(timer); resolveDone(); });
      fail(new Error('Card worker stopped.'), child);
    });
  }
  return { request, stop };
}
let singleton;
function getClient() { return singleton ||= createCardWorkerClient(); }
module.exports = { createCardWorkerClient, resolveCardWorker, requestCards: payload => getClient().request(payload), stopCardWorker: () => singleton?.stop() };
