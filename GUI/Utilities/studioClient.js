'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const childProcess = require('child_process');
const { getLayoutEnvironment } = require('../shared/constants');

function createStudioClient({ platform = process.platform, spawn = childProcess.spawn,
  exists = fs.existsSync, app = null, stopTimeout = 2500, startupTimeout = 120000 } = {}) {
  let active = null;
  const supported = platform === 'win32';
  function getCapabilities() {
    return { supported, windowWidth: 1920, windowHeight: 1080,
      defaultStudioPath: String.raw`C:\Program Files\Silhouette America\Silhouette Studio\Silhouette Studio.exe`,
      message: supported ? '' : 'Studio automation requires Windows. Open the DXF in Silhouette Studio and save it as a .studio3 file.' };
  }
  function command() {
    const electronApp = app || require('electron').app;
    const base = electronApp.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '../bin');
    const exe = path.join(base, 'studio_worker.exe');
    if (exists(exe) || electronApp.isPackaged) return { exe, args: [], cwd: base };
    const root = path.resolve(__dirname, '../..');
    const python = path.join(root, 'venv', 'Scripts', 'python.exe');
    return { exe: exists(python) ? python : 'python', args: [path.join(root, 'studio_worker.py')], cwd: root };
  }
  function killTree(child) {
    if (child.exitCode != null || child.signalCode != null) return;
    if (platform === 'win32' && Number.isInteger(child.pid)) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: false, windowsHide: true });
      killer.once('error', () => child.kill());
    } else child.kill('SIGKILL');
  }
  function startStudioJob(request, onEvent = () => {}) {
    if (!supported) return Promise.reject(new Error(getCapabilities().message));
    if (active) return Promise.reject(new Error('A Studio job is already active.'));
    if (!request || typeof request !== 'object' || Array.isArray(request)) return Promise.reject(new Error('Invalid Studio request.'));
    return new Promise((resolve, reject) => {
      let child;
      try {
        const target = command();
        child = spawn(target.exe, target.args, { cwd: target.cwd, shell: false, windowsHide: true,
          env: { ...process.env, ...getLayoutEnvironment(), PYTHONIOENCODING: 'utf-8' } });
      } catch (error) { reject(error); return; }
      const job = active = { child, promptId: null, settled: false, result: null, stopping: false, stopTimer: null,
        completion: null, finish: null, failure: null, progress: { completed: 0, currentFile: null } };
      job.completion = new Promise(done => { job.done = done; });
      let stderr = '';
      const reader = readline.createInterface({ input: child.stdout });
      const timer = setTimeout(() => {
        fail(new Error('Studio worker did not become ready.'));
      }, startupTimeout);
      function finish(error) {
        if (job.settled) return;
        job.settled = true;
        clearTimeout(timer); clearTimeout(job.stopTimer); reader.close();
        if (active === job) active = null;
        job.done();
        if (error || job.failure) reject(error || job.failure);
        else if (!job.result?.ok) reject(new Error(job.result?.error || 'Studio operation failed.'));
        else resolve(job.result.result || {});
      }
      const fail = error => {
        if (job.settled || job.failure) return;
        job.failure = error;
        clearTimeout(timer); clearTimeout(job.stopTimer);
        killTree(child);
        // Keep the concurrency lock while Windows stops the process tree.
        if (!job.settled) job.stopTimer = setTimeout(() => finish(error), stopTimeout);
      };
      job.finish = finish;
      const send = payload => {
        if (!child.stdin.writable) { fail(new Error('Studio worker input is closed.')); return; }
        child.stdin.write(JSON.stringify(payload) + '\n', error => { if (error) fail(error); });
      };
      job.send = send;
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
      child.stdin.on('error', fail);
      reader.on('line', line => {
        if (job.settled) return;
        let event;
        try { event = JSON.parse(line); }
        catch { fail(new Error('Studio worker returned invalid JSON.')); return; }
        if (!event || typeof event.event !== 'string') { fail(new Error('Studio worker returned an invalid event.')); return; }
        if (event.event === 'ready') {
          clearTimeout(timer);
          if (event.supported === false) { fail(new Error(event.message || 'Studio automation is unavailable.')); return; }
          send({ command: 'start', request });
          if (job.stopping) send({ command: 'stop' });
        }
        if (event.event === 'prompt') job.promptId = event.promptId;
        if (event.event === 'progress') job.progress = { ...job.progress, ...event };
        if (event.event === 'output' && !event.skipped && !event.error) job.progress.completed++;
        try { onEvent(event); } catch (_) { /* A detached renderer must not break worker cleanup. */ }
        if (event.event === 'result') {
          job.result = event;
          job.promptId = null;
          child.stdin.end();
          // Keep the concurrency lock until the child exits and releases inputs.
          clearTimeout(job.stopTimer);
          job.stopTimer = setTimeout(() => fail(new Error('Studio worker did not exit after its result.')), stopTimeout);
        }
      });
      child.once('error', error => { fail(error); });
      child.once('close', (code, signal) => {
        if (job.failure) { finish(job.failure); return; }
        if (!job.result) {
          if (job.stopping) { job.result = { ok: true, result: { ...job.progress, canceled: true, forced: true,
            message: 'Studio automation was stopped. Completed files are kept; inspect the current Studio document.' } }; }
          else { finish(new Error(`Studio worker stopped (${signal || code}).${stderr.trim() ? '\n' + stderr.trim() : ''}`)); return; }
        }
        finish();
      });
    });
  }
  function replyStudioPrompt({ promptId, value } = {}) {
    if (!active || active.stopping || !active.promptId || promptId !== active.promptId) throw new Error('This Studio prompt is no longer active.');
    if (typeof value !== 'string' || value.length > 1000) throw new Error('Invalid Studio prompt reply.');
    active.promptId = null;
    active.send({ command: 'reply', promptId, value });
    return { accepted: true };
  }
  function stopStudioJob() {
    const job = active;
    if (!job) return Promise.resolve({ stopped: false });
    if (!job.stopping) {
      job.stopping = true;
      job.promptId = null;
      job.send({ command: 'stop' });
      job.stopTimer = setTimeout(() => {
        killTree(job.child);
        // Bound shutdown even if the OS does not deliver the exit event.
        job.result = { ok: true, result: { ...job.progress, canceled: true, forced: true } };
        job.finish();
      }, stopTimeout);
    }
    return job.completion.then(() => ({ stopped: true }));
  }
  return { getCapabilities, startStudioJob, replyStudioPrompt, stopStudioJob,
    shutdownStudioClient: stopStudioJob };
}

let singleton;
function client() { return singleton || (singleton = createStudioClient()); }
module.exports = { createStudioClient,
  getCapabilities: () => client().getCapabilities(),
  startStudioJob: (...args) => client().startStudioJob(...args),
  replyStudioPrompt: (...args) => client().replyStudioPrompt(...args),
  stopStudioJob: () => client().stopStudioJob(),
  shutdownStudioClient: () => client().shutdownStudioClient() };
