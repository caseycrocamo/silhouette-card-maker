'use strict';
// Renderer fixture: no Studio process or mouse/keyboard automation is started.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
let win, supported = false, current = null;
const catalog = { card_sizes: [{ name: 'poker', width: '63mm', height: '88mm' }],
  paper_sizes: [{ name: 'letter', width: '11in', height: '8.5in' }], output_dir: 'C:\\templates' };
async function main() {
  await app.whenReady();
  ipcMain.handle('template-request', () => catalog);
  ipcMain.handle('updates:get-state', () => ({ enabled: false, status: 'idle', notificationVisible: false }));
  ipcMain.handle('studio-capabilities', () => ({ supported, defaultStudioPath: 'C:\\Studio.exe',
    message: supported ? '' : 'Studio automation requires Windows. Open the DXF in Silhouette Studio and save it as a .studio3 file.' }));
  ipcMain.handle('studio-select-path', (_event, { kind }) => kind === 'dxf' ? 'C:\\資料\\letter-poker.dxf' : kind === 'studio3' ? 'C:\\資料\\cards.studio3' : 'C:\\coordinates.json');
  ipcMain.handle('studio-start', (event, request) => {
    if (request.operation === 'calibrate') {
      return new Promise(resolve => {
        current = { resolve, sender: event.sender };
        event.sender.send('studio-event', { event: 'prompt', promptId: 'fixture', kind: 'element',
          message: 'Page setup: move the pointer over the control.', choices: ['record', 'skip', 'back'] });
      });
    }
    assert.equal(request.dryRun, true);
    assert.equal(request.inputPath, 'C:\\資料\\letter-poker.dxf');
    event.sender.send('studio-event', { event: 'preview', inputPath: request.inputPath,
      outputPath: request.outputPath, paperWidth: '11in', paperHeight: '8.5in', orientation: 'landscape' });
    return { dryRun: true, completed: 0 };
  });
  ipcMain.handle('studio-reply', (_event, reply) => {
    assert.deepEqual(reply, { promptId: 'fixture', value: 'skip' });
    const job = current; current = null; job.resolve({ calibrationPath: 'C:\\coordinates.json', elements: 1 });
    return { accepted: true };
  });
  ipcMain.handle('studio-stop', () => {
    if (current) { const job = current; current = null; job.resolve({ canceled: true }); }
    return { stopped: true };
  });
  win = new BrowserWindow({ show: false, width: 1200, height: 1000,
    webPreferences: { nodeIntegration: true, contextIsolation: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('ERR_FILE_NOT_FOUND')) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async (code, message) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (errors.length) throw new Error(errors.join('\n'));
      if (await js(code)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(message + ': ' + await js('document.body.innerText'));
  };
  const page = path.resolve(__dirname, '../GUI/Tools/tools.html');
  await win.loadFile(page);
  await wait("document.getElementById('studioCapability').textContent.includes('requires Windows')", 'Unsupported message');
  assert.equal(await js("document.getElementById('studioStart').disabled"), true);
  supported = true;
  await win.loadFile(page);
  await wait("!document.getElementById('studioStart').disabled", 'Supported controls');
  await js("document.querySelector('[data-studio-pick=dxf]').click()");
  await wait("document.getElementById('studioInput').value.includes('letter-poker')", 'DXF picker');
  await js("document.querySelector('[data-studio-pick=studio3]').click()");
  await wait("document.getElementById('studioOutput').value.endsWith('cards.studio3')", 'Output picker');
  await js("document.getElementById('studioForm').requestSubmit()");
  await wait("document.getElementById('studioStatus').textContent.includes('Preview complete')", 'Dry-run result');
  assert(await js("document.getElementById('studioResults').textContent.includes('letter-poker')"));
  await js("document.getElementById('studioOperation').value='calibrate';document.getElementById('studioOperation').dispatchEvent(new Event('change'));document.getElementById('studioCalibration').value='C:\\\\coordinates.json';document.getElementById('studioForm').requestSubmit()");
  await wait("!document.getElementById('studioPrompt').hidden", 'Calibration prompt');
  assert(await js("document.getElementById('studioPrompt').textContent.includes('three seconds')"));
  await js("Array.from(document.querySelectorAll('#studioPrompt button')).find(button=>button.textContent==='Skip').click()");
  await wait("document.getElementById('studioStatus').textContent.includes('calibration saved')", 'Calibration response');
  await js("document.getElementById('studioForm').requestSubmit()");
  await wait("!document.getElementById('studioPrompt').hidden", 'Second calibration prompt');
  await js("document.getElementById('studioStop').click()");
  await wait("document.getElementById('studioStatus').textContent.includes('Automation stopped')", 'Stop response');
  assert(await js("document.getElementById('studioPrompt').hidden"));
  console.log('Studio unsupported, dry-run, calibration prompt/reply, and stop UI checks passed.');
  win.destroy(); app.quit();
}
main().catch(error => { console.error(error); if (win) win.destroy(); app.exit(1); });
