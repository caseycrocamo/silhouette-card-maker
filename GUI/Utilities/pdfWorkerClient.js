const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const {
  getFrontDir,
  getBackDir,
  getOutputDir,
  getDoubleSidedDir,
  getDataDir
} = require('../shared/constants');

// --- Module state ---------------------------------------------------------

let worker = null;          // the current ChildProcess, or null
let rl = null;              // readline interface over worker.stdout
let ready = false;          // true once the worker has emitted {"ready":true}
let readyPromise = null;    // resolves when the current worker becomes ready
let readyResolve = null;
let stderrBuffer = '';      // captured stderr for crash diagnostics

const queue = [];           // pending jobs: { req, resolve, reject }
let inFlight = null;        // the job currently awaiting a response, or null

// Eager-respawn backoff control
let respawnAttempts = 0;
const MAX_RESPAWN_ATTEMPTS = 5;
const RESPAWN_BACKOFF_MS = 1000;
let respawnTimer = null;
// Set once respawns are exhausted; surfaced to the next caller.
let fatalError = null;

const STOP_GRACE_MS = 2000;

// --- Path resolution ------------------------------------------------------

// Factors out the path/exe-name/isPackaged logic that previously lived
// (duplicated) in ipcHandlers.js, pointed at a single pdf_worker binary.
function resolveWorkerPath() {
  const executableName = process.platform === 'win32' ? 'pdf_worker.exe' : 'pdf_worker';
  const isPackaged = require('electron').app.isPackaged;
  const baseDir = isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '../bin');
  const exePath = path.join(baseDir, executableName);
  return { exePath, cwd: baseDir };
}

// --- Worker lifecycle -----------------------------------------------------

// Idempotent: starts the worker if it isn't already running/starting.
function startPdfWorker() {
  if (worker) return;

  const { exePath, cwd } = resolveWorkerPath();

  // Ensure the executable has proper permissions on Unix-like systems.
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(exePath, '755');
    } catch (err) {
      console.error('Error setting executable permissions:', err);
    }
  }

  ready = false;
  stderrBuffer = '';
  readyPromise = new Promise((resolve) => { readyResolve = resolve; });

  let child;
  try {
    child = spawn(exePath, [], {
      shell: false,
      cwd,
      env: {
        ...process.env,
        CARD_MAKER_FRONT_DIR: getFrontDir(),
        CARD_MAKER_BACK_DIR: getBackDir(),
        CARD_MAKER_OUTPUT_DIR: getOutputDir(),
        CARD_MAKER_DOUBLE_SIDED_DIR: getDoubleSidedDir(),
        CARD_MAKER_DATA_DIR: getDataDir()
      }
    });
  } catch (err) {
    // spawn threw synchronously (e.g. exePath missing) — treat as a crash.
    worker = null;
    handleWorkerDown(`Failed to start PDF worker: ${err.message}`);
    return;
  }

  worker = child;

  if (child.stderr) {
    child.stderr.on('data', (data) => { stderrBuffer += data.toString(); });
  }

  // Line-by-line framing over stdout — handles multi-chunk lines and \r\n.
  rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => onWorkerLine(child, line));

  child.on('error', (err) => {
    if (child !== worker) return;
    handleWorkerDown(`PDF worker error: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    if (child !== worker) return;
    const detail = signal ? `signal ${signal}` : `code ${code}`;
    handleWorkerDown(`PDF worker exited (${detail}).`);
  });
}

function onWorkerLine(child, rawLine) {
  if (child !== worker) return;

  const line = rawLine.trim();
  if (!line) return;

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    // Stray non-JSON noise (e.g. native C-level writes to fd 1). Skip it
    // rather than rejecting the in-flight request.
    return;
  }

  if (parsed && parsed.ready === true) {
    ready = true;
    respawnAttempts = 0;
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
    pump();
    return;
  }

  // A response line correlates to the in-flight job by strict FIFO order.
  if (inFlight) {
    const job = inFlight;
    inFlight = null;
    job.resolve(parsed);
    pump();
  }
  // If there is no in-flight job, this is an unexpected/extra line — ignore.
}

// Rejects in-flight + queued jobs, tears down the dead worker, and (unless
// the attempt cap is hit) eagerly respawns a fresh one after a backoff.
function handleWorkerDown(message) {
  const err = new Error(`${message}${stderrBuffer ? `\n${stderrBuffer.trim()}` : ''}`);

  const dead = worker;
  worker = null;
  ready = false;

  if (rl) {
    try { rl.close(); } catch (e) { /* ignore */ }
    rl = null;
  }
  if (dead) {
    try { dead.removeAllListeners(); } catch (e) { /* ignore */ }
  }

  // Reject everything that was waiting.
  if (inFlight) {
    inFlight.reject(err);
    inFlight = null;
  }
  while (queue.length) {
    queue.shift().reject(err);
  }

  // If ready never resolved for this worker, unblock any awaiters.
  if (readyResolve) {
    readyResolve();
    readyResolve = null;
  }

  // Eager respawn with backoff + attempt cap.
  respawnAttempts += 1;
  if (respawnAttempts > MAX_RESPAWN_ATTEMPTS) {
    fatalError = new Error(
      `PDF worker failed to stay running after ${MAX_RESPAWN_ATTEMPTS} attempts. Last error: ${err.message}`
    );
    return;
  }

  if (respawnTimer) clearTimeout(respawnTimer);
  respawnTimer = setTimeout(() => {
    respawnTimer = null;
    if (!worker) startPdfWorker();
  }, RESPAWN_BACKOFF_MS);
}

// Graceful shutdown: end stdin (worker's EOF-exit path), SIGKILL if it
// lingers past the grace period.
function stopPdfWorker() {
  if (respawnTimer) {
    clearTimeout(respawnTimer);
    respawnTimer = null;
  }

  const dead = worker;
  if (!dead) return;

  // Prevent the exit handler from triggering a respawn on intentional stop.
  worker = null;
  ready = false;
  if (rl) {
    try { rl.close(); } catch (e) { /* ignore */ }
    rl = null;
  }
  try { dead.removeAllListeners(); } catch (e) { /* ignore */ }

  const shutdownErr = new Error('PDF worker stopped.');
  if (inFlight) {
    inFlight.reject(shutdownErr);
    inFlight = null;
  }
  while (queue.length) {
    queue.shift().reject(shutdownErr);
  }

  try {
    if (dead.stdin && !dead.stdin.destroyed) dead.stdin.end();
  } catch (e) { /* ignore */ }

  const killTimer = setTimeout(() => {
    try {
      if (!dead.killed) dead.kill('SIGKILL');
    } catch (e) { /* ignore */ }
  }, STOP_GRACE_MS);
  if (killTimer.unref) killTimer.unref();

  dead.once('exit', () => clearTimeout(killTimer));
}

// --- Request queue --------------------------------------------------------

function sendRequest(req) {
  return new Promise((resolve, reject) => {
    if (fatalError) {
      reject(fatalError);
      return;
    }
    startPdfWorker();
    if (fatalError) {
      reject(fatalError);
      return;
    }
    queue.push({ req, resolve, reject });
    pump();
  });
}

// Writes the next queued request to the worker if it's ready and idle.
function pump() {
  if (!worker || !ready) return;   // not started / not ready yet
  if (inFlight) return;            // a request is already outstanding
  if (queue.length === 0) return; // nothing to do

  const job = queue.shift();
  inFlight = job;

  const line = JSON.stringify(job.req) + '\n';
  try {
    worker.stdin.write(line);
  } catch (err) {
    inFlight = null;
    job.reject(new Error(`Failed to write to PDF worker: ${err.message}`));
  }
}

// --- Public request helpers ----------------------------------------------

async function runCreatePdf(argv) {
  return sendRequest({ command: 'create_pdf', args: Array.isArray(argv) ? argv : [] });
}

async function runOffsetPdf({ pdfPath, xOffset, yOffset, save } = {}) {
  const req = { command: 'offset_pdf' };
  if (pdfPath !== undefined && pdfPath !== null && pdfPath !== '') {
    req.pdf_path = pdfPath;
  }
  if (xOffset !== undefined && xOffset !== null && xOffset !== '') {
    req.x_offset = Number(xOffset);
  }
  if (yOffset !== undefined && yOffset !== null && yOffset !== '') {
    req.y_offset = Number(yOffset);
  }
  req.save = Boolean(save);
  return sendRequest(req);
}

module.exports = {
  startPdfWorker,
  stopPdfWorker,
  runCreatePdf,
  runOffsetPdf
};
