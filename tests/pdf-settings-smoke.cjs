"use strict";
// Run with GUI/node_modules/.bin/electron tests/pdf-settings-smoke.cjs.
// All source files and output live in a temporary folder.
const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "pdf settings é 一 "));
const directories = {};
for (const name of [
  "front",
  "back",
  "double_sided",
  "output",
  "data",
  "decklist",
]) {
  directories[name] = path.join(work, name);
  fs.mkdirSync(directories[name]);
}
const constants = require("../GUI/shared/constants");
for (const [getter, name] of Object.entries({
  getFrontDir: "front",
  getBackDir: "back",
  getDoubleSidedDir: "double_sided",
  getOutputDir: "output",
  getDataDir: "data",
  getDecklistDir: "decklist",
}))
  constants[getter] = () => directories[name];
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7Z8AAAAASUVORK5CYII=",
  "base64",
);
fs.writeFileSync(path.join(directories.front, "card é 一.png"), image);
let win;
const errors = [];
async function js(code) {
  return win.webContents.executeJavaScript(code);
}
async function waitFor(check, message) {
  process.stdout.write(message + "…\n");
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const unexpected = errors.filter(
      (message) => !message.includes("Fixture metadata failure"),
    );
    if (unexpected.length) throw new Error(unexpected.join("\n"));
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    message +
      ": " +
      (await js(
        "document.getElementById('validationSummary')?.textContent || document.getElementById('metadataError')?.textContent || ''",
      )),
  );
}
async function set(name, value) {
  await js(
    `(() => {const c=document.getElementById(${JSON.stringify("setting-" + name)});if(c.type==='checkbox')c.checked=${JSON.stringify(value)};else c.value=${JSON.stringify(String(value))};c.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
}
async function run() {
  app.commandLine.appendSwitch("disable-gpu");
  app.setPath("userData", path.join(work, "electron"));
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  let workerStarts = 0;
  const childProcess = require("node:child_process");
  const spawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    if (/pdf_worker(?:\.exe)?$/.test(command)) {
      workerStarts++;
      if (process.env.CARD_MAKER_SMOKE_SOURCE_WORKER)
        return spawn(
          process.env.CARD_MAKER_SMOKE_SOURCE_WORKER,
          [path.join(root, "pdf_worker.py")],
          { ...options, cwd: root },
        );
    }
    return spawn(command, args, options);
  };
  require("../GUI/Utilities/ipcHandlers");
  ipcMain.handle("updates:get-state", () => ({
    enabled: false,
    status: "idle",
    notificationVisible: false,
  }));
  dialog.showMessageBox = async () => ({ response: 1 });
  dialog.showSaveDialog = async () => ({ canceled: true });
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 900,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.webContents.on("console-message", (_event, level, message) => {
    if (level === 3 && !message.includes("ERR_FILE_NOT_FOUND"))
      errors.push(message);
  });
  await win.loadFile(path.join(root, "GUI/Home/home.html"));
  const draft = {
    version: 1,
    settings: {
      front_dir_path: directories.front,
      back_dir_path: directories.back,
      double_sided_dir_path: directories.double_sided,
      output_path: path.join(directories.output, "custom é 一.pdf"),
      only_fronts: true,
      ppi: 72,
    },
  };
  await js(
    `sessionStorage.setItem('pdfCreationSettings.v1',${JSON.stringify(JSON.stringify(draft))});sessionStorage.setItem('onlyFronts','true');sessionStorage.setItem('cardWorkflow','front_only');`,
  );
  const navigationStarted = Date.now();
  await win.loadFile(path.join(root, "GUI/CreatePDF/create.html"));
  await waitFor(
    () =>
      js(
        "Boolean(document.getElementById('setting-ppi')) && !document.getElementById('openSettings').disabled",
      ),
    "Settings did not load",
  );

  assert.equal(
    await js("document.getElementById('pdfSettingsDialog').open"),
    false,
  );
  async function open() {
    await js("document.getElementById('openSettings').click()");
  }
  async function save() {
    await js("document.getElementById('saveSettings').click()");
  }
  await open();
  assert.deepEqual(
    await js(
      "Array.from(document.querySelectorAll('.category span')).map(x=>x.textContent)",
    ),
    ["Page layout", "Image settings", "File settings"],
  );
  assert.equal(
    await js("document.querySelectorAll('#settingsPanel [data-name]').length"),
    28,
  );
  await waitFor(
    () => js("Boolean(document.querySelector('#pagePreview svg'))"),
    "Layout preview did not load",
  );
  const readyMs = Date.now() - navigationStarted;
  assert.equal(workerStarts, 0, "Navigation and preview must not start Python");
  assert(readyMs < 3000, `Screen and preview took ${readyMs}ms`);
  process.stdout.write(
    `Create PDF and preview ready in ${readyMs}ms without Python\n`,
  );
  assert.equal(
    await js(
      "getComputedStyle(document.getElementById('saveSettings')).borderTopStyle",
    ),
    "dashed",
  );
  assert.equal(
    await js(
      "getComputedStyle(document.getElementById('cancelSettings')).borderTopStyle",
    ),
    "dashed",
  );
  await js("document.querySelector('[data-category=file]').click()");
  assert(
    await js(
      "Array.from(document.querySelectorAll('.setting button')).every(button=>button.classList.contains('paper-button'))",
    ),
  );
  await js("document.querySelector('[data-category=page]').click()");
  const slots = await js(
    "document.querySelectorAll('#pagePreview svg rect').length",
  );
  assert(slots > 0);
  // Edits remain a draft until Save; Cancel restores fields and storage.
  await set("ppi", 150);
  assert.equal(
    await js(
      "JSON.parse(sessionStorage.getItem('pdfCreationSettings.v1')).settings.ppi",
    ),
    72,
  );
  await js("document.getElementById('cancelSettings').click()");
  assert.equal(await js("document.getElementById('setting-ppi').value"), "72");
  await open();
  await js(
    "document.getElementById('settingsSearch').value='compression';document.getElementById('settingsSearch').dispatchEvent(new Event('input'))",
  );
  assert(
    await js("!document.querySelector('[data-settings-category=file]').hidden"),
  );
  assert(
    await js("document.querySelector('[data-settings-category=page]').hidden"),
  );
  // Escape has the same discard behavior as Cancel.
  await js(
    "document.getElementById('pdfSettingsDialog').dispatchEvent(new Event('cancel',{cancelable:true}))",
  );
  assert.equal(
    await js("document.getElementById('pdfSettingsDialog').open"),
    false,
  );
  await open();
  await set("ppi", 0);
  await save();
  assert(
    await js(
      "document.getElementById('pdfSettingsDialog').open && document.getElementById('error-ppi').textContent.length>0",
    ),
  );
  assert.equal(await js("document.activeElement.id"), "setting-ppi");
  await set("ppi", 72);
  await set("skip", "0");
  await waitFor(
    () =>
      js("document.querySelector('#pagePreview svg text')?.textContent==='×'"),
    "Skipped position did not update preview",
  );
  await set("skip", "");
  await set("only_fronts", false);
  await js("document.getElementById('previewBack').click()");
  await waitFor(
    () =>
      js(
        "document.querySelector('#pagePreview svg')?.getAttribute('aria-label')==='Back sheet layout'",
      ),
    "Back preview did not load",
  );
  await set("only_fronts", true);
  await set("label", 'Label "quoted" é 一');
  await save();
  assert.equal(
    await js("document.getElementById('pdfSettingsDialog').open"),
    false,
  );
  await js("document.getElementById('createPdfBtn').click()");
  await waitFor(
    () => js("location.pathname.endsWith('/Utilities/pdf_viewer.html')"),
    "PDF did not open",
  );
  assert(
    fs
      .readFileSync(draft.settings.output_path)
      .subarray(0, 5)
      .equals(Buffer.from("%PDF-")),
  );
  await win.loadFile(path.join(root, "GUI/CreatePDF/create.html"));
  await waitFor(
    () =>
      js(
        "Boolean(document.getElementById('setting-ppi')) && !document.getElementById('openSettings').disabled",
      ),
    "Draft did not restore",
  );
  await open();
  await set("output_images", true);
  const imageDestination = path.join(directories.output, "new PNG pages é 一");
  await set("output_path", imageDestination);
  await save();
  await js("document.getElementById('createPdfBtn').click()");
  await waitFor(
    () =>
      js("document.getElementById('completion').textContent.includes('PNG')"),
    "PNG output did not complete",
  );
  assert(fs.existsSync(path.join(imageDestination, "page1.png")));
  await open();
  await js("document.getElementById('resetSettings').click()");
  assert.equal(await js("document.getElementById('setting-ppi').value"), "300");
  await js("document.getElementById('cancelSettings').click()");
  assert.equal(await js("document.getElementById('setting-ppi').value"), "72");
  // The modal contains its own scroll regions and works at narrow widths.
  win.setSize(480, 850);
  await open();
  assert(
    await js(
      "document.getElementById('pdfSettingsDialog').scrollWidth <= document.getElementById('pdfSettingsDialog').clientWidth",
    ),
    "Modal overflows horizontally",
  );
  await js("document.getElementById('cancelSettings').click()");
  if (process.env.PDF_SETTINGS_GUIDE_SCREENSHOT) {
    win.setSize(1440, 1000);
    await open();
    await waitFor(
      () => js("Boolean(document.querySelector('#pagePreview svg'))"),
      "Final preview did not render",
    );
    fs.writeFileSync(
      process.env.PDF_SETTINGS_GUIDE_SCREENSHOT,
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  assert.deepEqual(errors, []);
  process.stdout.write("PDF preferences modal Electron smoke passed\n");
}

const timeout = setTimeout(
  () => finish(new Error("PDF settings smoke timed out")),
  300000,
);
let finishing = false;
async function finish(error) {
  if (finishing) return;
  finishing = true;
  clearTimeout(timeout);
  if (error) process.stderr.write((error.stack || String(error)) + "\n");
  try {
    await require("../GUI/Utilities/pdfWorkerClient").stopPdfWorkerForUpdate();
  } catch {}
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}
run().then(() => finish(), finish);
