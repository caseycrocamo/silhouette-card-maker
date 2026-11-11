"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { getLayoutEnvironment, getCustomLayoutsPath } = require("../shared/constants");

let worker, reader, readyResolve, readyPromise, waiting, startupTimer, stderr = "";
const queue = [];
const DEADLINE_MS = 5 * 60 * 1000;

function workerPath() {
  const { app } = require("electron");
  const name = process.platform === "win32" ? "template_worker.exe" : "template_worker";
  const base = app.isPackaged ? path.join(process.resourcesPath, "bin") : path.join(__dirname, "../bin");
  const exe = path.join(base, name);
  if (fs.existsSync(exe)) return { exe, args: [], cwd: base };
  if (app.isPackaged) return { exe, args: [], cwd: base };
  const script = path.join(__dirname, "../../template_worker.py");
  const localPython = process.platform === "win32"
    ? path.join(path.dirname(script), "venv", "Scripts", "python.exe")
    : path.join(path.dirname(script), "venv", "bin", "python");
  const python = fs.existsSync(localPython) ? localPython : (process.platform === "win32" ? "python" : "python3");
  return { exe: python, args: [script], cwd: path.dirname(script) };
}
function startTemplateWorker() {
  if (worker) return;
  const { exe, args, cwd } = workerPath();
  readyPromise = new Promise(resolve => { readyResolve = resolve; });
  stderr = "";
  const child = worker = spawn(exe, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, ...getLayoutEnvironment(), SCM_CUSTOM_LAYOUT_PATH: getCustomLayoutsPath() } });
  startupTimer = setTimeout(() => {
    if (!readyResolve || child !== worker) return;
    worker = null;
    const resolve = readyResolve; readyResolve = null; resolve();
    const error = new Error("Template worker did not become ready.");
    if (waiting) { clearTimeout(waiting.timer); waiting.reject(error); waiting = null; }
    while (queue.length) queue.shift().reject(error);
    if (child) child.kill();
  }, 120000);
  worker.stderr.on("data", d => { stderr += d.toString(); });
  reader = readline.createInterface({ input: worker.stdout });
  reader.on("line", line => {
    if (child !== worker) return;
    let data;
    try { data = JSON.parse(line); } catch (_) {
      const child = worker; worker = null;
      const error = new Error("Template worker returned invalid JSON.");
      if (readyResolve) { readyResolve(); readyResolve = null; }
      if (waiting) { clearTimeout(waiting.timer); waiting.reject(error); waiting = null; }
      while (queue.length) queue.shift().reject(error);
      if (child) child.kill();
      return;
    }
    if (data.ready) { clearTimeout(startupTimer); if (readyResolve) readyResolve(); readyResolve = null; pump(); return; }
    const job = waiting; waiting = null;
    if (job) { clearTimeout(job.timer); data.ok ? job.resolve(data) : job.reject(new Error(data.error || "Template operation failed.")); }
    pump();
  });
  const down = () => {
    if (child !== worker) return;
    clearTimeout(startupTimer);
    worker = null;
    if (readyResolve) { readyResolve(); readyResolve = null; }
    if (waiting) { clearTimeout(waiting.timer); waiting.reject(new Error(`Template worker stopped.${stderr ? `\n${stderr.trim()}` : ""}`)); waiting = null; }
    while (queue.length) queue.shift().reject(new Error("Template worker stopped."));
  };
  worker.once("error", down); worker.once("exit", down);
}
function pump() {
  if (!worker || waiting || !queue.length) return;
  const job = waiting = queue.shift();
  job.timer = setTimeout(() => {
    if (waiting !== job) return;
    const child = worker; worker = null; waiting = null;
    job.reject(new Error("Template worker timed out."));
    while (queue.length) queue.shift().reject(new Error("Template worker timed out."));
    if (child) child.kill();
  }, DEADLINE_MS);
  worker.stdin.write(`${JSON.stringify(job.request)}\n`, error => {
    if (error && waiting === job) { waiting = null; clearTimeout(job.timer); job.reject(error); pump(); }
  });
}
function requestTemplate(payload) {
  return new Promise((resolve, reject) => {
    startTemplateWorker();
    queue.push({ request: payload, resolve, reject });
    readyPromise.then(() => { if (worker) pump(); else reject(new Error(`Could not start template worker.${stderr ? `\n${stderr.trim()}` : ""}`)); });
  });
}
function stopTemplateWorker() {
  const child = worker; worker = null;
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  if (readyResolve) { readyResolve(); readyResolve = null; }
  if (reader) { reader.close(); reader = null; }
  if (waiting) { clearTimeout(waiting.timer); waiting.reject(new Error("Template worker stopped.")); waiting = null; }
  while (queue.length) queue.shift().reject(new Error("Template worker stopped."));
  if (child) {
    child.removeAllListeners();
    return new Promise(resolve => {
      const killTimer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); resolve(); }, 2000);
      child.once("exit", () => { clearTimeout(killTimer); resolve(); });
      child.stdin.end();
      if (child.exitCode !== null || child.signalCode !== null) { clearTimeout(killTimer); resolve(); }
    });
  }
  return Promise.resolve();
}
function cancelTemplateRequest() {
  if (worker) worker.kill("SIGTERM");
}
module.exports = { startTemplateWorker, stopTemplateWorker, requestTemplate, cancelTemplateRequest };
