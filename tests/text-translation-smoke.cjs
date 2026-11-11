'use strict';
const { app, BrowserWindow, dialog, session, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-ui-é-'));
const python = process.env.CARD_MAKER_SMOKE_SOURCE_WORKER || path.join(root, 'venv/bin/python');
let win;
async function run() {
  app.setPath('userData', path.join(work, 'electron'));
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
  const constants = require('../GUI/shared/constants');
  constants.getOutputDir = () => work;
  const extra = path.join(work, 'custom.json');
  fs.writeFileSync(extra, JSON.stringify({ paper_sizes: { translation_smoke: { width: '11in', height: '8.5in' } } }));
  constants.getLayoutEnvironment = () => ({ SCM_EXTRA_LAYOUTS: extra });
  const cp = require('node:child_process'), spawn = cp.spawn;
  const calls = [];
  const nativeArm = process.platform === 'darwin' && cp.execFileSync('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1';
  const runPython = (args, options) => nativeArm
    ? spawn('/usr/bin/arch', ['-arm64', python, ...args], { ...options, cwd: root })
    : spawn(python, args, { ...options, cwd: root });
  cp.spawn = (command, args, options) => {
    if (/pdf_worker(?:\.exe)?$/.test(command)) return runPython([path.join(root, 'pdf_worker.py')], options);
    if (/translated_text_boxes_to_pdf(?:\.exe)?$/.test(command) || args?.some(arg => /translated_text_boxes_to_pdf\.py$/.test(arg))) {
      const actual = args.filter(arg => !/translated_text_boxes_to_pdf\.py$/.test(arg));
      calls.push(actual);
      return runPython([path.join(root, 'translated_text_boxes_to_pdf.py'), ...actual], options);
    }
    return spawn(command, args, options);
  };
  require('../GUI/Utilities/ipcHandlers');
  ipcMain.handle('updates:get-state', () => ({ enabled: false, status: 'idle', notificationVisible: false }));
  const source = path.join(work, '原稿.md'), output = path.join(work, 'chosen-é.pdf');
  fs.writeFileSync(source, '### Source card {W}\n\nDraw a card.');
  let cancelOpen = true, cancelSave = true;
  dialog.showOpenDialog = async () => ({ canceled: cancelOpen, filePaths: cancelOpen ? [] : [source] });
  dialog.showSaveDialog = async () => ({ canceled: cancelSave, filePath: cancelSave ? undefined : output });
  win = new BrowserWindow({ show: false, width: 1000, height: 1100, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('ERR_FILE_NOT_FOUND')) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async (predicate, message) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (errors.length) throw new Error(errors.join('\n'));
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(message + ': ' + await js('document.body.innerText'));
  };
  await win.loadFile(path.join(root, 'GUI/MagicTheGathering/text_translation.html'));
  await wait(() => js("!!document.querySelector('#paperSize option[value=translation_smoke]')"), 'Custom paper did not load');
  await js("document.getElementById('mdText').value='Keep this draft';document.getElementById('openMarkdownBtn').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await js("document.getElementById('mdText').value"), 'Keep this draft');
  const initialOutput = await js("document.getElementById('translationOutputPath').value");
  await js("document.getElementById('chooseTranslationOutputBtn').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await js("document.getElementById('translationOutputPath').value"), initialOutput);
  cancelOpen = false;
  await js("document.getElementById('openMarkdownBtn').click()");
  await wait(() => js("document.getElementById('mdText').value.startsWith('### Source')"), 'File did not open');
  cancelSave = false;
  await js("document.getElementById('chooseTranslationOutputBtn').click()");
  await wait(() => js("document.getElementById('translationOutputPath').value.endsWith('chosen-é.pdf')"), 'Output picker');
  for (const quality of [0, 100]) {
    await js(`document.getElementById('mdText').value='### Edited card {2}{U}\\n\\n**Rules text**';document.getElementById('paperSize').value='translation_smoke';document.getElementById('ppi').value='72';document.getElementById('quality').value='${quality}';document.getElementById('mdForm').requestSubmit()`);
    await wait(() => js("document.getElementById('translationStatus').textContent.startsWith('PDF created:')"), 'PDF not generated');
    assert(fs.readFileSync(output).subarray(0, 4).equals(Buffer.from('%PDF')));
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0][calls[0].indexOf('--quality') + 1], '0');
  assert.equal(calls[1][calls[1].indexOf('--quality') + 1], '100');
  assert.notEqual(calls[0][calls[0].indexOf('--input_path') + 1], calls[1][calls[1].indexOf('--input_path') + 1]);
  for (const call of calls) assert(!fs.existsSync(call[call.indexOf('--input_path') + 1]));
  assert.equal(fs.readFileSync(source, 'utf8'), '### Source card {W}\n\nDraw a card.');
  assert((await js("document.getElementById('translationResult').href")).includes('pdf_viewer.html?path='));
  fs.writeFileSync(path.join(work, 'translation.png'), (await win.webContents.capturePage()).toPNG());
  require('../GUI/Utilities/pdfWorkerClient').stopPdfWorker();
  console.log('Translation source-worker UI checks passed. Artifacts: ' + work);
  win.destroy(); app.quit();
}
run().catch(error => { console.error(error); if (win) win.destroy(); app.exit(1); });
