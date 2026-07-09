const { BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runCreatePdf, runOffsetPdf } = require('./pdfWorkerClient');
const {
  getFrontDir,
  getBackDir,
  getOutputDir,
  getDecklistDir,
  getDoubleSidedDir,
  getDataDir,
  getCalibrationDir
} = require('../shared/constants');
let watcher = null;

// Ensure all game directories exist on startup
function ensureDirectoriesExist() {
  const dirs = [getFrontDir(), getBackDir(), getOutputDir(), getDecklistDir(), getDoubleSidedDir()];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
}
ensureDirectoriesExist();

function startFrontDirWatcher() {
  if (watcher) return;
  const fs = require('fs');
  const frontDir = getFrontDir();
  watcher = fs.watch(frontDir, { persistent: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.png')) {
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('front-images-changed');
      });
    }
  });
}
startFrontDirWatcher();
ipcMain.handle('clear-front-images', async () => {
  const fs = require('fs');
  const frontDir = getFrontDir();
  try {
    const files = await fs.promises.readdir(frontDir);
    for (const file of files) {
      if (file.endsWith('.png')) {
        await fs.promises.unlink(require('path').join(frontDir, file));
      }
    }
    return 'Front images cleared.';
  } catch (err) {
    return 'Error clearing images: ' + err;
  }
});
ipcMain.handle('get-default-calibration-pdf', async () => {
  return path.join(getCalibrationDir(), 'letter_calibration.pdf');
});

ipcMain.handle('select-pdf-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    defaultPath: getOutputDir(),
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return null;
  }
  return filePaths[0];
});

ipcMain.handle('select-back-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return null;
  }
  const backDir = getBackDir();
  try {
    const files = await fs.promises.readdir(backDir);
    for (const file of files) {
      await fs.promises.unlink(path.join(backDir, file));
    }
    const ext = path.extname(filePaths[0]) || '.png';
    const destName = `back${ext}`;
    await fs.promises.copyFile(filePaths[0], path.join(backDir, destName));
    return destName;
  } catch (err) {
    throw new Error('Error uploading back image: ' + err);
  }
});

ipcMain.handle('clear-back-image', async () => {
  const backDir = getBackDir();
  try {
    const files = await fs.promises.readdir(backDir);
    for (const file of files) {
      await fs.promises.unlink(path.join(backDir, file));
    }
    return 'Back image cleared.';
  } catch (err) {
    return 'Error clearing back image: ' + err;
  }
});

ipcMain.handle('run-create-pdf', async (event, argsString) => {
  // Split argsString into array, respecting quotes
  const args = argsString.match(/(?:[^"\s]+|"[^"]*")+/g) || [];
  const resp = await runCreatePdf(args);
  if (resp.ok) {
    return resp.log;
  }
  throw new Error(resp.error || 'Exited with error');
});

ipcMain.handle('read-offset-data', async () => {
  const offsetPath = path.join(getDataDir(), 'offset_data.json');
  try {
    const contents = await fs.promises.readFile(offsetPath, 'utf8');
    const data = JSON.parse(contents);
    return {
      x_offset: data.x_offset || 0,
      y_offset: data.y_offset || 0
    };
  } catch (err) {
    return { x_offset: 0, y_offset: 0 };
  }
});

ipcMain.handle('save-offset-data', async (event, { x_offset, y_offset } = {}) => {
  const dataDir = getDataDir();
  await fs.promises.mkdir(dataDir, { recursive: true });
  const offsetPath = path.join(dataDir, 'offset_data.json');
  const data = {
    x_offset: Number(x_offset) || 0,
    y_offset: Number(y_offset) || 0
  };
  await fs.promises.writeFile(offsetPath, JSON.stringify(data, null, 4), 'utf8');
  return data;
});

ipcMain.handle('run-offset-pdf', async (event, { pdfPath, xOffset, yOffset, save } = {}) => {
  const resp = await runOffsetPdf({ pdfPath, xOffset, yOffset, save });
  if (resp.ok) {
    return resp.log; // must still contain "Offset PDF: <path>" on success
  }
  throw new Error(resp.error || 'Exited with error');
});

ipcMain.handle('run-md-to-pdf', async (event, options = {}) => {
  const markdownText = typeof options.markdownText === 'string' ? options.markdownText : '';
  const paperSize = options.paperSize || 'letter';
  const ppi = options.ppi || 300;
  const quality = options.quality || 75;
  const outputFileName = options.outputFileName || 'translatedTextBoxes.pdf';

  if (!markdownText.trim()) {
    throw new Error('Markdown input is empty.');
  }

  const inputPath = path.join(getDecklistDir(), 'entries.md');
  const outputPath = path.join(getOutputDir(), outputFileName);

  await fs.promises.mkdir(getDecklistDir(), { recursive: true });
  await fs.promises.mkdir(getOutputDir(), { recursive: true });
  await fs.promises.writeFile(inputPath, markdownText, 'utf8');

  const projectRoot = path.join(__dirname, '../..');
  const executableName = process.platform === 'win32'
    ? 'translated_text_boxes_to_pdf.exe'
    : 'translated_text_boxes_to_pdf';
  const isPackaged = require('electron').app.isPackaged;
  const baseDir = isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '../bin');
  const exePath = path.join(baseDir, executableName);

  if (process.platform !== 'win32' && fs.existsSync(exePath)) {
    try {
      fs.chmodSync(exePath, '755');
    } catch (err) {
      console.error('Error setting executable permissions:', err);
    }
  }

  return new Promise((resolve, reject) => {
    const args = [
      '--input_path', inputPath,
      '--output_path', outputPath,
      '--paper_size', paperSize,
      '--ppi', String(ppi),
      '--quality', String(quality),
    ];

    let command = exePath;
    let commandArgs = args;
    let cwd = baseDir;

    // Fallback to Python script in development if the executable hasn't been built yet.
    if (!fs.existsSync(exePath)) {
      const scriptPath = path.join(projectRoot, 'translated_text_boxes_to_pdf.py');
      const pythonPath = process.platform === 'win32'
        ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(projectRoot, '.venv', 'bin', 'python');

      if (!fs.existsSync(scriptPath)) {
        reject(`Cannot find translated_text_boxes_to_pdf.py at ${scriptPath}`);
        return;
      }

      if (!fs.existsSync(pythonPath)) {
        reject(`Cannot find Python interpreter at ${pythonPath}`);
        return;
      }

      command = pythonPath;
      commandArgs = [scriptPath, ...args];
      cwd = projectRoot;
    }

    const mdProcess = spawn(command, commandArgs, {
      shell: false,
      cwd,
      env: {
        ...process.env,
        CARD_MAKER_DECKLIST_DIR: getDecklistDir(),
        CARD_MAKER_OUTPUT_DIR: getOutputDir(),
      },
    });

    let stdout = '';
    let stderr = '';
    mdProcess.stdout.on('data', data => { stdout += data.toString(); });
    mdProcess.stderr.on('data', data => { stderr += data.toString(); });
    mdProcess.on('error', (err) => {
      reject(`Failed to start markdown PDF process: ${err.message}`);
    });
    mdProcess.on('close', code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(stderr || `Exited with code ${code}`);
      }
    });
  });
});

ipcMain.handle('get-front-images', async () => {
  try {
    const files = await fs.promises.readdir(getFrontDir());
    return files.filter(f => f.endsWith('.png'));
  } catch (err) {
    return [];
  }
});

// Example for other directories (add similar handlers as needed):
ipcMain.handle('get-back-images', async () => {
  try {
    const files = await fs.promises.readdir(getBackDir());
    return files.filter(f => /\.(png|jpe?g)$/i.test(f));
  } catch (err) {
    return [];
  }
});
// Add similar logic for output, decklist, double_sided as needed
