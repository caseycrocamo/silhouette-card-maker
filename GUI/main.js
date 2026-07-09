const { app, BrowserWindow } = require('electron');
require('./Utilities/ipcHandlers');
const { startPdfWorker, stopPdfWorker } = require('./Utilities/pdfWorkerClient');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('Home/home.html');
}

app.whenReady().then(() => {
  createWindow();
  // Fire-and-forget: start the persistent PDF worker in the background so the
  // window paints immediately while the ~12s worker startup tax runs behind it.
  startPdfWorker();
});

app.on('before-quit', () => {
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
