"use strict";
// Run with CARD_MAKER_SMOKE_SOURCE_WORKER=/path/to/python GUI/node_modules/.bin/electron tests/printer-calibration-smoke.cjs.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'printer-calibration-é-'));
const dirs = Object.fromEntries(['front', 'back', 'double_sided', 'output', 'data', 'decklist', 'calibration'].map(name => {
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  return [name, dir];
}));

async function main() {
  app.commandLine.appendSwitch('disable-gpu');
  app.setPath('userData', path.join(work, 'electron'));
  await app.whenReady();
  const constants = require('../GUI/shared/constants');
  for (const name of ['front', 'back', 'double_sided', 'output', 'data', 'decklist']) {
    const method = `get${name.split('_').map(x => x[0].toUpperCase() + x.slice(1)).join('')}Dir`;
    constants[method] = () => dirs[name];
  }
  constants.getGeneratedCalibrationDir = () => dirs.calibration;
  constants.getCalibrationDir = () => path.join(root, 'calibration');
  constants.getLayoutEnvironment = () => ({ SCM_EXTRA_LAYOUTS: '' });
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  dialog.showSaveDialog = async () => ({ canceled: true });
  const childProcess = require('node:child_process');
  const realSpawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => /pdf_worker(?:\.exe)?$/.test(command)
    ? realSpawn(process.env.CARD_MAKER_SMOKE_SOURCE_WORKER, [path.join(root, 'pdf_worker.py')], { ...options, cwd: root })
    : realSpawn(command, args, options);
  require('../GUI/Utilities/ipcHandlers');
  ipcMain.handle('updates:get-state', () => ({ enabled: false, status: 'idle', automaticChecks: false }));
  const errors = [];
  const win = new BrowserWindow({
    show: false, width: 1100, height: 900,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level === 3 && !message.includes('ERR_FILE_NOT_FOUND')) errors.push(message);
  });
  const js = code => win.webContents.executeJavaScript(code);
  await win.loadFile(path.join(root, 'GUI/Settings/settings.html'));
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (errors.length) throw new Error(errors.join('\n'));
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error(`${message}: ${await js("document.getElementById('calibrationPaperSizes')?.textContent")}`);
  };
  await waitFor(() => js("document.querySelectorAll('input[name=calibrationPaperSize]').length > 0"), 'Paper sizes did not load');
  assert(await js("['editAngleOffset','runXOffset','runYOffset','runAngleOffset','runPpi','offsetOutputPath','calibrationPpi','calibrationOutputDir','generateCalibrationBtn'].every(id => document.getElementById(id))"));
  await js("document.getElementById('selectAllCalibrationPapers').click()");
  assert(await js("Array.from(document.querySelectorAll('input[name=calibrationPaperSize]')).every(input => input.checked)"));
  await js("document.getElementById('selectAllCalibrationPapers').click(); document.querySelector('input[name=calibrationPaperSize][value=letter]').checked=true; document.querySelector('input[name=calibrationPaperSize][value=letter]').dispatchEvent(new Event('change',{bubbles:true}))");

  await js("document.getElementById('editXOffset').value='2'; document.getElementById('editYOffset').value='-3'; document.getElementById('editAngleOffset').value='0.25'; window.alert=()=>{}; document.getElementById('saveOffsetBtn').click()");
  const savedPath = path.join(dirs.data, 'offset_data.json');
  await waitFor(() => fs.existsSync(savedPath), 'Offsets did not save');
  assert.deepEqual(JSON.parse(fs.readFileSync(savedPath, 'utf8')), { x_offset: 2, y_offset: -3, angle_offset: 0.25 });

  const inputPdf = path.join(root, 'calibration', 'letter-calibration.pdf');
  const outputPdf = path.join(dirs.output, 'offset-result.pdf');
  await js(`document.getElementById('offsetPdfPath').value=${JSON.stringify(inputPdf)}; document.getElementById('offsetOutputPath').value=${JSON.stringify(outputPdf)}; document.getElementById('runPpi').value='150'; document.getElementById('runOffsetPdfBtn').click()`);
  await waitFor(() => js("location.pathname.endsWith('/Utilities/pdf_viewer.html')"), 'Offset PDF did not open');
  assert(fs.existsSync(outputPdf), 'Offset output PDF was not created');
  assert.deepEqual(JSON.parse(fs.readFileSync(savedPath, 'utf8')), { x_offset: 2, y_offset: -3, angle_offset: 0.25 }, 'Applying overrides changed saved values');

  await win.loadFile(path.join(root, 'GUI/Settings/settings.html'));
  await waitFor(() => js("document.querySelectorAll('input[name=calibrationPaperSize]').length > 0"), 'Settings did not reload');
  const sheetDir = path.join(dirs.calibration, 'selected');
  fs.mkdirSync(sheetDir);
  await js(`document.querySelector('input[name=calibrationPaperSize][value=letter]').checked=true; document.getElementById('calibrationPpi').value='150'; document.getElementById('calibrationOutputDir').value=${JSON.stringify(sheetDir)}; document.getElementById('generateCalibrationBtn').click()`);
  await waitFor(() => js("location.pathname.endsWith('/Utilities/pdf_viewer.html')"), 'Generated sheet did not open in viewer');
  const sheetPath = path.join(sheetDir, 'letter-calibration.pdf');
  assert(fs.existsSync(sheetPath), 'Generated calibration PDF was not created');
  assert.equal(await js('window.__uncaughtError || null'), null);
  process.stdout.write('Printer calibration Settings smoke passed.\n');
  await win.close();
  app.quit();
}

main().catch(error => {
  console.error(error);
  app.exit(1);
});
