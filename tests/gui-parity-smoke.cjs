'use strict';
// Exercise real template/PDF workers and IPC using isolated source-worker processes.
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-parity-é-'));
const python = process.env.CARD_MAKER_SMOKE_SOURCE_WORKER || path.join(root, 'venv/bin/python');
let win;
async function run() {
  app.setPath('userData', path.join(work, 'electron'));
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true }));
  const constants = require('../GUI/shared/constants');
  for (const [getter, directory] of Object.entries({ getFrontDir: 'front', getBackDir: 'back', getDoubleSidedDir: 'double', getOutputDir: 'output', getDecklistDir: 'decklist', getDataDir: 'data', getGeneratedCalibrationDir: 'calibration' })) {
    const target = path.join(work, directory); fs.mkdirSync(target, { recursive: true }); constants[getter] = () => target;
  }
  const extra = path.join(work, 'custom-layouts.json'); fs.writeFileSync(extra, '{}');
  constants.getCustomLayoutsPath = () => extra;
  constants.getLayoutEnvironment = () => ({ SCM_EXTRA_LAYOUTS: extra, SCM_CUTTING_TEMPLATES_DIR: path.join(work, 'templates') });
  const cp = require('node:child_process'), spawn = cp.spawn;
  cp.spawn = (command, args, options) => {
    if (/pdf_worker(?:\.exe)?$/.test(command)) return spawn(python, [path.join(root, 'pdf_worker.py')], { ...options, cwd: root });
    if (/template_worker(?:\.exe)?$/.test(command) || args?.some(arg => /template_worker\.py$/.test(arg))) return spawn(python, [path.join(root, 'template_worker.py')], { ...options, cwd: root });
    return spawn(command, args, options);
  };
  require('../GUI/Utilities/ipcHandlers');
  ipcMain.handle('updates:get-state', () => ({ enabled: false, status: 'idle', notificationVisible: false }));
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(work, 'custom.dxf') });
  win = new BrowserWindow({ show: false, width: 1200, height: 950, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('ERR_FILE_NOT_FOUND')) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async (check, message) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) { if (errors.length) throw new Error(errors.join('\n')); if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error(message + ': ' + await js('document.body.innerText'));
  };
  await win.loadFile(path.join(root, 'GUI/Tools/tools.html'));
  await wait(() => js("document.querySelector('#cardSize').options.length > 0"), 'Template catalog');
  await js("document.querySelector('[name=cardMode][value=custom]').click();document.querySelector('[name=paperMode][value=custom]').click();document.getElementById('cardWidth').value='60mm';document.getElementById('cardHeight').value='85mm';document.getElementById('cardName').value='smoke_card';document.getElementById('paperWidth').value='8.5in';document.getElementById('paperHeight').value='11in';document.getElementById('paperName').value='smoke_paper';document.getElementById('chooseFile').click()");
  await wait(() => js("document.getElementById('outputFile').value.endsWith('custom.dxf')"), 'Output picker');
  await js("document.getElementById('templateForm').requestSubmit()");
  await wait(() => js("document.getElementById('status').textContent==='Generation complete.'"), 'Generate template');
  assert(fs.existsSync(path.join(work, 'custom.dxf')));
  assert(JSON.parse(fs.readFileSync(extra)).paper_sizes.smoke_paper);
  fs.writeFileSync(path.join(work, 'templates.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadFile(path.join(root, 'GUI/Settings/settings.html'));
  await wait(() => js("!!document.querySelector('[name=calibrationPaperSize][value=smoke_paper]')"), 'Live custom paper');
  await js("document.querySelectorAll('[name=calibrationPaperSize]').forEach(input=>input.checked=input.value==='smoke_paper');document.getElementById('calibrationPpi').value='72';document.getElementById('calibrationOutputDir').value=" + JSON.stringify(path.join(work, 'calibration')) + ";document.getElementById('generateCalibrationBtn').click()");
  await wait(() => win.webContents.getURL().includes('pdf_viewer.html'), 'Generated calibration viewer');
  assert(fs.existsSync(path.join(work, 'calibration/smoke_paper-calibration.pdf')));
  await require('../GUI/Utilities/templateWorkerClient').stopTemplateWorker();
  require('../GUI/Utilities/pdfWorkerClient').stopPdfWorker();
  console.log('Real template → saved custom paper → calibration UI passed. Artifacts: ' + work);
  win.destroy(); app.quit();
}
run().catch(error => { console.error(error); if (win) win.destroy(); app.exit(1); });
