'use strict';

// Optional Electron renderer smoke test. Run with:
// GUI/node_modules/.bin/electron tests/update-ui-smoke.cjs
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerUpdateIpc } = require('../GUI/Utilities/updateIpc');

const projectRoot = path.resolve(__dirname, '..');
const guiRoot = path.join(projectRoot, 'GUI');
const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'silhouette-update-ui-'));
const calls = [];
const windows = new Set();
const rendererErrors = [];
let state = {
  status: 'available', currentVersion: '1.1.0', availableVersion: '1.2.0',
  automaticChecks: true, lastCheckedAt: '2026-10-14T12:00:00.000Z',
  releaseNotes: '<img src=x onerror=alert(1)>\n' + Array.from({ length: 180 }, (_, index) => `Smoke release note ${index + 1}: a long release description for viewport layout checks.`).join('\n'),
  progress: 0, canInstall: true, error: null, notificationVisible: true,
  enabled: true, releaseUrl: 'https://github.com/caseycrocamo/silhouette-card-maker/releases'
};
let mainWindow;
let quitting = false;
let removeUpdateIpc;
const service = new EventEmitter();

service.getState = () => ({ ...state });
service.setState = changes => {
  state = { ...state, ...changes };
  service.emit('state-changed', { ...state });
  return { ...state };
};
service.setAutomaticChecks = value => {
  calls.push(['updates:set-automatic', value]);
  return service.setState({ automaticChecks: value });
};
service.checkForUpdates = () => {
  calls.push(['updates:check']);
  return service.setState({ status: 'available', error: null });
};
service.downloadUpdate = () => {
  calls.push(['updates:download']);
  return service.setState({ status: 'downloading', progress: 37 });
};
service.installUpdate = () => {
  // Simulate the user cancelling the main-process install confirmation.
  calls.push(['updates:install']);
  return service.setState({ status: 'ready-to-install', notificationVisible: false, error: 'Restart cancelled. The downloaded update remains available.' });
};
service.dismissUpdate = () => {
  calls.push(['updates:dismiss']);
  return service.setState({ notificationVisible: false });
};
service.openReleasePage = () => { calls.push(['updates:open-release']); return true; };
service.cancelDownload = () => {
  calls.push(['updates:cancel-download']);
  return service.setState({ status: 'available', progress: 0 });
};

app.commandLine.appendSwitch('disable-gpu');
app.on('will-quit', () => {
  try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch { /* Chromium may still hold cache files until process exit. */ }
});

function broadcast() {
  for (const win of windows) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('updates:state', state);
  }
}

function installMocks() {
  const handlers = {
    'read-offset-data': () => ({ x_offset: 0, y_offset: 0 }),
    'get-default-calibration-pdf': () => '',
    'offset-data-exists': () => true,
    'get-front-images': () => [],
    'get-double-sided-images': () => [],
    'get-back-images': () => []
  };
  Object.entries(handlers).forEach(([channel, handler]) => ipcMain.handle(channel, handler));
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function loadPage(relativePath) {
  const filePath = path.join(guiRoot, relativePath);
  await mainWindow.loadFile(filePath);
  await wait(250);
  if (rendererErrors.length) throw new Error(`Renderer error on ${relativePath}: ${rendererErrors.join('\n')}`);
}

async function assertBanner(relativePath, expectedStatus) {
  await loadPage(relativePath);
  const result = await mainWindow.webContents.executeJavaScript(`(() => {
    const banner = document.getElementById('sharedUpdateBanner');
    return {
      exists: Boolean(banner), visible: Boolean(banner && !banner.classList.contains('hidden')),
      text: banner ? banner.textContent : '',
      status: window.__silhouetteUpdateControls && window.__silhouetteUpdateControls.getState()?.status,
      noteElement: banner && banner.querySelector('img'),
      viewportHeight: window.innerHeight,
      bannerRect: banner && (() => { const rect = banner.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height, maxHeight: getComputedStyle(banner).maxHeight }; })(),
      notesBox: banner && (() => { const notes = banner.querySelector('#sharedUpdateBannerNotes'); return { height: notes.clientHeight, scrollHeight: notes.scrollHeight }; })(),
      actionRect: banner && (() => { const button = banner.querySelector('button'); const rect = button.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; })()
    };
  })()`);
  if (!result.exists || !result.visible) throw new Error(`Update banner missing/hidden in ${relativePath}`);
  if (result.status !== expectedStatus) throw new Error(`Expected ${expectedStatus} on ${relativePath}, got ${result.status}`);
  const expectedLabel = expectedStatus === 'downloading' ? 'Downloading update' : '1.2.0';
  if (!result.text.includes(expectedLabel)) throw new Error(`Update status/version missing from banner on ${relativePath}`);
  if (result.noteElement) throw new Error(`Release notes were interpreted as HTML on ${relativePath}`);
  if (result.bannerRect.height > result.viewportHeight - result.bannerRect.top || result.bannerRect.bottom > result.viewportHeight) {
    throw new Error(`Update banner exceeds the viewport on ${relativePath}: ${JSON.stringify(result.bannerRect)}`);
  }
  if (expectedStatus === 'available' && (result.notesBox.scrollHeight <= result.notesBox.height || result.notesBox.height > 100)) {
    throw new Error(`Long release notes are not bounded and scrollable on ${relativePath}: ${JSON.stringify(result.notesBox)}`);
  }
  if (result.actionRect.bottom > result.viewportHeight || result.actionRect.top < 0) {
    throw new Error(`Update action is outside the viewport on ${relativePath}: ${JSON.stringify(result.actionRect)}`);
  }
}

async function run() {
  app.setPath('userData', tempUserData);
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  installMocks();
  mainWindow = new BrowserWindow({
    show: false, width: 800, height: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  windows.add(mainWindow);
  removeUpdateIpc = registerUpdateIpc({ ipcMain, BrowserWindow, service, guiRoot });
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) rendererErrors.push(message);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => rendererErrors.push(`Renderer process exited: ${details.reason}`));
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) rendererErrors.push(`Load failed (${code}): ${description} ${url}`);
  });

  await assertBanner('Settings/settings.html', 'available');
  const settings = await mainWindow.webContents.executeJavaScript(`({
    version: document.getElementById('updateCurrentVersion').textContent,
    notes: document.getElementById('updateReleaseNotes').textContent,
    noteImageCount: document.getElementById('updateReleaseNotes').querySelectorAll('img').length,
    status: document.getElementById('updateStatus').textContent
  })`);
  if (settings.version !== '1.1.0' || settings.noteImageCount !== 0 || !settings.notes.includes('<img')) {
    throw new Error(`Settings did not safely render mocked update state: ${JSON.stringify(settings)}`);
  }
  await mainWindow.webContents.executeJavaScript(`(() => {
    const checkbox = document.getElementById('automaticUpdateChecks');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(100);
  if (!calls.some(call => call[0] === 'updates:set-automatic' && call[1] === false) || state.automaticChecks !== false) {
    throw new Error('Automatic-check toggle did not use validated update IPC.');
  }
  await mainWindow.webContents.executeJavaScript(`document.getElementById('checkUpdatesBtn').click()`);
  await wait(100);
  if (!calls.some(call => call[0] === 'updates:check')) throw new Error('Settings manual check did not invoke mocked IPC.');
  for (const page of ['Home/home.html', 'CreatePDF/create.html', 'MagicTheGathering/decklist.html']) {
    await assertBanner(page, 'available');
  }
  await assertBanner('Settings/settings.html', 'available');
  await mainWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Download update').click()`);
  await wait(100);
  if (!calls.some(call => call[0] === 'updates:download') || state.status !== 'downloading') throw new Error('Settings download action did not invoke mocked IPC.');
  await assertBanner('Home/home.html', 'downloading');
  const downloadState = await mainWindow.webContents.executeJavaScript(`({
    progress: document.querySelector('#sharedUpdateBanner progress')?.value,
    notes: document.getElementById('sharedUpdateBanner').textContent
  })`);
  if (downloadState.progress !== 37) throw new Error(`Banner progress was not rendered: ${JSON.stringify(downloadState)}`);
  service.setState({ status: 'ready-to-install', progress: 100, notificationVisible: true, error: null });
  await assertBanner('Settings/settings.html', 'ready-to-install');
  await mainWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Restart and install').click()`);
  await wait(100);
  const cancelled = await mainWindow.webContents.executeJavaScript(`({
    status: document.getElementById('updateStatus').textContent,
    error: document.getElementById('updateError').textContent,
    visible: !document.getElementById('updateError').hidden
  })`);
  if (!calls.some(call => call[0] === 'updates:install') || state.status !== 'ready-to-install' || !cancelled.visible || !cancelled.error.includes('Restart cancelled')) {
    throw new Error(`Cancelled install did not preserve ready state and show the error: ${JSON.stringify(cancelled)}`);
  }
  console.log('Update UI Electron smoke passed: real update IPC sender validation, all four pages, plain-text notes, toggle/download actions, progress, and cancelled-install recovery.');
}

const hardTimeout = setTimeout(() => {
  console.error('Update UI smoke timed out.');
  app.exit(1);
}, 20000);

run().then(() => finish(0), error => {
  console.error(error.stack || error);
  finish(1);
});

function finish(code) {
  if (quitting) return;
  quitting = true;
  clearTimeout(hardTimeout);
  if (removeUpdateIpc) removeUpdateIpc();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  windows.clear();
  process.exitCode = code;
  app.quit();
}
