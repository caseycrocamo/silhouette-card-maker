const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
require('./Utilities/ipcHandlers');
require('./Utilities/cardImageCache').registerCardImageCache();
const { startPdfWorker, stopPdfWorker, stopPdfWorkerForUpdate } = require('./Utilities/pdfWorkerClient');
const { stopTemplateWorker } = require('./Utilities/templateWorkerClient');
const { stopCardWorker } = require('./Utilities/cardWorkerClient');
const { shutdownStudioClient } = require('./Utilities/studioClient');
const { createUpdateService } = require('./Utilities/updateService');
const { registerUpdateIpc } = require('./Utilities/updateIpc');
const { jobActivity } = require('./Utilities/jobActivity');
const { registerAppShutdown } = require('./Utilities/appShutdown');
let updateService;
let removeUpdateIpc;
const shutdown = registerAppShutdown({
  app,
  beforeShutdown: () => {
    if (updateService) updateService.stop();
    if (removeUpdateIpc) removeUpdateIpc();
  },
  shutdownTasks: [stopTemplateWorker, shutdownStudioClient, stopCardWorker, stopPdfWorker]
});

async function prepareInstall() {
  await jobActivity.pauseAndDrain();
  const window = BrowserWindow.getFocusedWindow();
  const options = {
    type: 'question',
    title: 'Restart and install update',
    message: 'Restart Silhouette Card Maker to install the update?',
    detail: 'Current jobs have finished. Unsaved form changes will be lost. Your images, decklists, PDFs, and saved calibration will be preserved.',
    buttons: ['Cancel', 'Restart and install'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  if (response !== 1) throw new Error('Restart cancelled. The downloaded update remains available.');
  await stopPdfWorkerForUpdate();
  await stopCardWorker();
  await stopTemplateWorker();
  await shutdownStudioClient();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 680,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile(path.join(__dirname, 'Home/home.html'));
}

app.whenReady().then(() => {
  if (shutdown.isQuitting()) return;
  createWindow();
  // Fire-and-forget: start the persistent PDF worker in the background so the
  // window paints immediately while the ~12s worker startup tax runs behind it.
  startPdfWorker();
  updateService = createUpdateService({
    app,
    updater: require('electron-updater').autoUpdater,
    shell,
    prepareInstall,
    cancelInstall: () => {
      jobActivity.resume();
      startPdfWorker();
    }
  });
  removeUpdateIpc = registerUpdateIpc({ ipcMain, BrowserWindow, service: updateService });
  updateService.start();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !shutdown.isQuitting()) {
    app.quit();
  }
});

app.on('activate', () => {
  if (!shutdown.isQuitting() && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
