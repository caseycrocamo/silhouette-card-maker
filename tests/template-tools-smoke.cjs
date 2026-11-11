"use strict";
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
let win;
async function run() {
  await app.whenReady();
  ipcMain.handle("template-request", (_event, req) => req.command === "list"
    ? { ok: true, output_dir: "/tmp/templates", card_sizes: [{ name: "poker", width: "63mm", height: "88mm" }], paper_sizes: [{ name: "letter", width: "11in", height: "8.5in" }] }
    : { ok: true, path: req.output_path, capacity: 9, cols: 3, rows: 3 });
  ipcMain.handle("select-template-path", async () => null);
  ipcMain.handle("cancel-template-request", () => ({ ok: true }));
  ipcMain.handle("updates:get-state", () => ({ status: "idle", notificationVisible: false }));
  win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  await win.loadFile(path.join(__dirname, "../GUI/Tools/tools.html"));
  await win.webContents.executeJavaScript("new Promise(resolve => setTimeout(resolve, 100))");
  const result = await win.webContents.executeJavaScript(`(() => ({
    card: document.querySelector('#cardSize').value,
    hasCustom: !!document.querySelector('#cardWidth'),
    hasBatch: !!document.querySelector('#batchOptimize'),
    canChooseOutput: !!document.querySelector('#chooseFile'),
  }))()`);
  assert.deepEqual(result, { card: "poker", hasCustom: true, hasBatch: true, canChooseOutput: true });
  await win.webContents.executeJavaScript(`document.querySelector('#templateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
  await win.webContents.executeJavaScript("new Promise(resolve => setTimeout(resolve, 100))");
  const status = await win.webContents.executeJavaScript("document.querySelector('#status').textContent");
  assert.equal(status, "Generation complete.");
  win.close();
  app.quit();
}
run().catch(error => { console.error(error); if (win) win.destroy(); app.exit(1); });
