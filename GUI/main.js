const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
require('./Utilities/ipcHandlers');
const { startPdfWorker, stopPdfWorker, stopPdfWorkerForUpdate } = require('./Utilities/pdfWorkerClient');
const { createUpdateService } = require('./Utilities/updateService');
const { registerUpdateIpc } = require('./Utilities/updateIpc');
const { jobActivity } = require('./Utilities/jobActivity');
let updateService;
let removeUpdateIpc;

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
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile(path.join(__dirname, 'Home/home.html'));
}

app.whenReady().then(() => {
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

app.on('before-quit', () => {
  if (updateService) updateService.stop();
  if (removeUpdateIpc) removeUpdateIpc();
  stopPdfWorker();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopPdfWorker();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
