"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const Module = require("node:module");

test("template worker client requests JSON lines and waits for shutdown", async () => {
  const originalLoad = Module._load;
  let child;
  class Child extends EventEmitter {
    constructor() {
      super(); this.stdout = new PassThrough(); this.stderr = new PassThrough(); this.exitCode = null; this.signalCode = null;
      this.stdin = new Writable({ write(chunk, _encoding, done) { const req = JSON.parse(chunk.toString()); child.stdout.write(JSON.stringify({ ok: true, echo: req.command }) + "\n"); done(); } });
      this.stdin.on("finish", () => setImmediate(() => { this.exitCode = 0; this.emit("exit", 0, null); }));
    }
    kill(signal) { this.signalCode = signal || "SIGTERM"; this.exitCode = 0; this.emit("exit", 0, this.signalCode); return true; }
  }
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return { app: { isPackaged: false } };
    if (request === "../shared/constants" && parent?.filename.endsWith("templateWorkerClient.js"))
      return { getLayoutEnvironment: () => ({}), getCustomLayoutsPath: () => "/tmp/custom-layouts.json" };
    if (request === "child_process") return { spawn: () => (child = new Child()) };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const file = require.resolve("../GUI/Utilities/templateWorkerClient");
    delete require.cache[file];
    const client = require(file);
    const pending = client.requestTemplate({ command: "list" });
    setImmediate(() => child.stdout.write('{"ready":true}\n'));
    assert.deepEqual(await pending, { ok: true, echo: "list" });
    await client.stopTemplateWorker();
  } finally {
    Module._load = originalLoad;
    const file = require.resolve("../GUI/Utilities/templateWorkerClient"); delete require.cache[file];
  }
});
