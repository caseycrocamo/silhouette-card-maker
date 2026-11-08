const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  runCreatePdf,
  runOffsetPdf,
  preflightCreatePdf,
} = require("./pdfWorkerClient");
const { jobActivity } = require("./jobActivity");
const {
  getFrontDir,
  getBackDir,
  getOutputDir,
  getDecklistDir,
  getDoubleSidedDir,
  getDataDir,
  getCalibrationDir,
} = require("../shared/constants");
let watcher = null;
let doubleSidedWatcher = null;
const sourceWatchers = new Map();
const approvedPdfOverwrites = new Map();

const pdfValueOptions = new Set([
  "--card_size",
  "--paper_size",
  "--registration",
  "--registration_orientation",
  "--specialty",
  "--skip",
  "--fit",
  "--fit_backs",
  "--crop",
  "--crop_backs",
  "--extend_edges",
  "--extend_edges_backs",
  "--extend_corners",
  "--extend_corners_backs",
  "--extend_bleed",
  "--extend_bleed_backs",
  "--label",
  "--ppi",
  "--quality",
  "--output_path",
  "--front_dir_path",
  "--back_dir_path",
  "--double_sided_dir_path",
]);
const pdfFlagOptions = new Set([
  "--borderless",
  "--only_fronts",
  "--load_offset",
  "--show_outline",
  "--output_images",
]);
const imageFilename =
  /\.(png|apng|jpe?g|jpx|gif|webp|tiff?|bmp|avif|qoi|dds)$/i;
async function imageFiles(directory) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  return entries
    .map((entry) =>
      typeof entry === "string" ? entry : entry.isFile() ? entry.name : null,
    )
    .filter((name) => name && imageFilename.test(name));
}
function validatePdfArgv(argv) {
  if (
    !Array.isArray(argv) ||
    argv.some((value) => typeof value !== "string" || value.includes("\0"))
  )
    throw new Error("PDF settings must be an array of text arguments.");
  const seen = new Set();
  for (let i = 0; i < argv.length; ) {
    const option = argv[i];
    if (!pdfFlagOptions.has(option) && !pdfValueOptions.has(option))
      throw new Error(`Invalid PDF option: ${option}`);
    if (option !== "--skip" && seen.has(option))
      throw new Error(`Duplicate PDF option: ${option}`);
    seen.add(option);
    if (pdfFlagOptions.has(option)) {
      i++;
      continue;
    }
    if (!pdfValueOptions.has(option) || i + 1 >= argv.length)
      throw new Error(`Invalid PDF option or missing value: ${option}`);
    i += 2;
  }
  return argv;
}
function optionValue(argv, option) {
  const index = optionIndex(argv, option);
  return index < 0 ? undefined : argv[index + 1];
}
function optionIndex(argv, sought) {
  for (let i = 0; i < argv.length; ) {
    const option = argv[i];
    if (option === sought) return i;
    i += pdfFlagOptions.has(option) ? 1 : 2;
  }
  return -1;
}
function hasFlag(argv, flag) {
  return optionIndex(argv, flag) >= 0;
}
function withOptionValue(argv, option, value) {
  const result = argv.slice();
  const index = optionIndex(result, option);
  if (index < 0) result.push(option, value);
  else result[index + 1] = value;
  return result;
}
function imagesDestination(requested) {
  const target = requested || path.join(getOutputDir(), "game.pdf");
  let isDirectory = false;
  if (fs.existsSync(target)) {
    try {
      isDirectory = fs.statSync(target).isDirectory();
    } catch (error) {
      /* treat unavailable as a file-like target */
    }
  }
  return path.resolve(
    target.toLowerCase().endsWith(".pdf") && !isDirectory
      ? path.dirname(target)
      : target,
  );
}
function selectedDirectory(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error("Source directory must be an absolute path.");
  return path.resolve(value);
}
function watchSelectedDirectory(directory, channel, pattern) {
  const current = sourceWatchers.get(channel);
  if (current?.directory === directory) return;
  if (current) {
    try {
      current.handle.close();
    } catch (error) {
      /* already closed */
    }
    sourceWatchers.delete(channel);
  }
  try {
    const handle = fs.watch(
      directory,
      { persistent: true },
      (eventType, filename) => {
        if (filename && pattern.test(filename.toString())) {
          BrowserWindow.getAllWindows().forEach((win) =>
            win.webContents.send(channel),
          );
        }
      },
    );
    handle.on("error", () => {
      sourceWatchers.delete(channel);
      try {
        handle.close();
      } catch (error) {
        /* already closed */
      }
    });
    sourceWatchers.set(channel, { directory, handle });
  } catch (error) {
    // The selected folder may not exist yet; the list request still reports an empty list.
  }
}
app.on("before-quit", () => {
  for (const { handle } of sourceWatchers.values()) {
    try {
      handle.close();
    } catch (error) {
      /* already closed */
    }
  }
  sourceWatchers.clear();
  for (const handle of [watcher, doubleSidedWatcher]) {
    try {
      handle?.close();
    } catch (error) {
      /* already closed */
    }
  }
});
async function confirmImageClear(directory, label) {
  const result = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Cancel", "Clear images"],
    defaultId: 0,
    cancelId: 0,
    message: `Clear images in ${directory}?`,
    detail: `This removes image files from the selected ${label} folder.`,
  });
  return result.response === 1;
}

// Shared paths must agree in the main process and Node-enabled renderers.
ipcMain.on("get-user-data-dir", (event) => {
  event.returnValue = app.isPackaged ? app.getPath("userData") : null;
});

// Ensure all game directories exist on startup
function ensureDirectoriesExist() {
  const dirs = [
    getFrontDir(),
    getBackDir(),
    getOutputDir(),
    getDecklistDir(),
    getDoubleSidedDir(),
  ];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
}
ensureDirectoriesExist();

function startFrontDirWatcher() {
  if (watcher) return;
  const fs = require("fs");
  const frontDir = getFrontDir();
  watcher = fs.watch(frontDir, { persistent: true }, (eventType, filename) => {
    if (filename && imageFilename.test(filename.toString())) {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("front-images-changed");
      });
    }
  });
  watcher.on("error", () => {
    try {
      watcher?.close();
    } catch (error) {
      /* already closed */
    }
    watcher = null;
  });
}
startFrontDirWatcher();

function startDoubleSidedDirWatcher() {
  if (doubleSidedWatcher) return;
  const fs = require("fs");
  const doubleSidedDir = getDoubleSidedDir();
  doubleSidedWatcher = fs.watch(
    doubleSidedDir,
    { persistent: true },
    (eventType, filename) => {
      if (filename && imageFilename.test(filename.toString())) {
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send("double-sided-images-changed");
        });
      }
    },
  );
  doubleSidedWatcher.on("error", () => {
    try {
      doubleSidedWatcher?.close();
    } catch (error) {
      /* already closed */
    }
    doubleSidedWatcher = null;
  });
}
startDoubleSidedDirWatcher();

ipcMain.handle("clear-front-images", async (event, directory) => {
  const fs = require("fs");
  const frontDir = selectedDirectory(directory, getFrontDir());
  try {
    if (!(await confirmImageClear(frontDir, "front source")))
      return "Front image clearing canceled.";
    for (const file of await imageFiles(frontDir))
      await fs.promises.unlink(path.join(frontDir, file));
    return "Front images cleared.";
  } catch (err) {
    return "Error clearing images: " + err;
  }
});
ipcMain.handle("offset-data-exists", async () => {
  return fs.existsSync(path.join(getDataDir(), "offset_data.json"));
});

ipcMain.handle("get-default-calibration-pdf", async () => {
  return path.join(getCalibrationDir(), "letter-calibration.pdf");
});

ipcMain.handle("select-pdf-file", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    defaultPath: getOutputDir(),
    properties: ["openFile"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return null;
  }
  return filePaths[0];
});

ipcMain.handle(
  "select-pdf-setting-path",
  async (event, { kind, defaultPath } = {}) => {
    if (kind === "directory") {
      const result = await dialog.showOpenDialog({
        defaultPath,
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled || !result.filePaths?.length
        ? null
        : result.filePaths[0];
    }
    if (kind === "pdf") {
      const result = await dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (result.canceled || !result.filePath) return null;
      if (fs.existsSync(result.filePath)) {
        try {
          approvedPdfOverwrites.set(result.filePath, {
            mtimeMs: fs.statSync(result.filePath).mtimeMs,
            time: Date.now(),
          });
        } catch (error) {
          /* recheck at create time */
        }
      }
      return result.filePath;
    }
    throw new Error("Path kind must be directory or pdf.");
  },
);

ipcMain.handle("open-pdf-output-folder", async (event, folderPath) => {
  if (typeof folderPath !== "string" || !path.isAbsolute(folderPath))
    throw new Error("Output folder must be an absolute path.");
  const error = await require("electron").shell.openPath(folderPath);
  if (error) throw new Error(error);
  return true;
});

// Settings and schematic previews are built from the same Python layout resolver.
// Reading them must not queue behind worker startup or an active PDF job.
ipcMain.handle("get-pdf-capabilities", () =>
  require("../shared/pdfCatalog.json"),
);

ipcMain.handle("preflight-create-pdf", async (event, argv) =>
  jobActivity.run(async () => {
    const response = await preflightCreatePdf(validatePdfArgv(argv));
    if (!response || response.ok === false)
      throw new Error(response?.error || "PDF preflight failed.");
    return response.result || response;
  }),
);

ipcMain.handle("select-back-image", async (event, directory) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: [
          "png",
          "apng",
          "jpg",
          "jpeg",
          "jpx",
          "gif",
          "webp",
          "tif",
          "tiff",
          "bmp",
          "avif",
          "qoi",
          "dds",
        ],
      },
    ],
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return null;
  }
  const backDir = selectedDirectory(directory, getBackDir());
  try {
    await fs.promises.access(filePaths[0]);
    await fs.promises.mkdir(backDir, { recursive: true });
    const ext = path.extname(filePaths[0]) || ".png";
    const destName = `back${ext}`;
    const destination = path.join(backDir, destName);
    const existingImages = await imageFiles(backDir);
    if (existingImages.length) {
      const confirmation = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Cancel", "Replace back images"],
        defaultId: 0,
        cancelId: 0,
        message: `Replace back images in ${backDir}?`,
        detail: `The selected image will replace ${existingImages.length} existing image file(s). Other files will be kept.`,
      });
      if (confirmation.response !== 1) return null;
    }
    if (path.resolve(filePaths[0]) !== path.resolve(destination))
      await fs.promises.copyFile(filePaths[0], destination);
    for (const file of await imageFiles(backDir)) {
      if (file !== destName) await fs.promises.unlink(path.join(backDir, file));
    }
    return destName;
  } catch (err) {
    throw new Error("Error uploading back image: " + err);
  }
});

ipcMain.handle("clear-back-image", async (event, directory) => {
  const backDir = selectedDirectory(directory, getBackDir());
  try {
    if (!(await confirmImageClear(backDir, "back source")))
      return "Back image clearing canceled.";
    for (const file of await imageFiles(backDir))
      await fs.promises.unlink(path.join(backDir, file));
    return "Back image cleared.";
  } catch (err) {
    return "Error clearing back image: " + err;
  }
});

ipcMain.handle("run-create-pdf", async (event, argv) =>
  jobActivity.run(async () => {
    let args = validatePdfArgv(argv);
    const isImages = hasFlag(args, "--output_images");
    if (isImages) {
      const destination = imagesDestination(optionValue(args, "--output_path"));
      let existing = [];
      try {
        existing = (await fs.promises.readdir(destination)).filter((name) =>
          /^page\d+\.png$/i.test(name),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (existing.length) {
        const confirmation = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Cancel", "Replace pages"],
          defaultId: 0,
          cancelId: 0,
          message: `Replace ${existing.length} existing PNG page(s)?`,
          detail: `Matching pageN.png files in ${destination} will be overwritten. Other files will be kept.`,
        });
        if (confirmation.response !== 1) return { canceled: true };
      }
    } else {
      const requestedPath =
        optionValue(args, "--output_path") ||
        path.join(getOutputDir(), "game.pdf");
      if (fs.existsSync(requestedPath)) {
        let approved = false;
        const priorApproval = approvedPdfOverwrites.get(requestedPath);
        approvedPdfOverwrites.delete(requestedPath);
        if (priorApproval && Date.now() - priorApproval.time < 5 * 60 * 1000) {
          try {
            approved =
              fs.statSync(requestedPath).mtimeMs === priorApproval.mtimeMs;
          } catch (error) {
            /* ask again if the file changed */
          }
        }
        if (!approved) {
          const choice = await dialog.showSaveDialog({
            defaultPath: requestedPath,
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (choice.canceled || !choice.filePath) return { canceled: true };
          args = withOptionValue(args, "--output_path", choice.filePath);
        }
      }
    }
    const resp = await runCreatePdf(args);
    if (resp.ok) {
      return { ...(resp.result || {}), log: resp.log || "" };
    }
    throw new Error(resp.error || "Exited with error");
  }),
);

ipcMain.handle("read-offset-data", async () => {
  const offsetPath = path.join(getDataDir(), "offset_data.json");
  try {
    const contents = await fs.promises.readFile(offsetPath, "utf8");
    const data = JSON.parse(contents);
    return {
      x_offset: data.x_offset || 0,
      y_offset: data.y_offset || 0,
      angle_offset: data.angle_offset || 0,
    };
  } catch (err) {
    return { x_offset: 0, y_offset: 0, angle_offset: 0 };
  }
});

ipcMain.handle(
  "save-offset-data",
  async (event, { x_offset, y_offset } = {}) => {
    const dataDir = getDataDir();
    await fs.promises.mkdir(dataDir, { recursive: true });
    const offsetPath = path.join(dataDir, "offset_data.json");
    let angle_offset = 0;
    try {
      const saved = JSON.parse(await fs.promises.readFile(offsetPath, "utf8"));
      angle_offset = Number(saved.angle_offset) || 0;
    } catch (err) {
      // Use the default angle if no valid offset file exists.
    }
    const data = {
      x_offset: Number(x_offset) || 0,
      y_offset: Number(y_offset) || 0,
      angle_offset,
    };
    await fs.promises.writeFile(
      offsetPath,
      JSON.stringify(data, null, 4),
      "utf8",
    );
    return data;
  },
);

ipcMain.handle(
  "run-offset-pdf",
  async (event, { pdfPath, xOffset, yOffset, save } = {}) =>
    jobActivity.run(async () => {
      const resp = await runOffsetPdf({ pdfPath, xOffset, yOffset, save });
      if (resp.ok) {
        return resp.log; // must still contain "Offset PDF: <path>" on success
      }
      throw new Error(resp.error || "Exited with error");
    }),
);

ipcMain.handle("run-md-to-pdf", async (event, options = {}) =>
  jobActivity.run(async () => {
    const markdownText =
      typeof options.markdownText === "string" ? options.markdownText : "";
    const paperSize = options.paperSize || "letter";
    const ppi = options.ppi || 300;
    const quality = options.quality || 75;
    const outputFileName = options.outputFileName || "translatedTextBoxes.pdf";

    if (!markdownText.trim()) {
      throw new Error("Markdown input is empty.");
    }

    const inputPath = path.join(getDecklistDir(), "entries.md");
    const outputPath = path.join(getOutputDir(), outputFileName);

    await fs.promises.mkdir(getDecklistDir(), { recursive: true });
    await fs.promises.mkdir(getOutputDir(), { recursive: true });
    await fs.promises.writeFile(inputPath, markdownText, "utf8");

    const projectRoot = path.join(__dirname, "../..");
    const executableName =
      process.platform === "win32"
        ? "translated_text_boxes_to_pdf.exe"
        : "translated_text_boxes_to_pdf";
    const isPackaged = require("electron").app.isPackaged;
    const baseDir = isPackaged
      ? path.join(process.resourcesPath, "bin")
      : path.join(__dirname, "../bin");
    const exePath = path.join(baseDir, executableName);

    if (process.platform !== "win32" && fs.existsSync(exePath)) {
      try {
        fs.chmodSync(exePath, "755");
      } catch (err) {
        console.error("Error setting executable permissions:", err);
      }
    }

    return new Promise((resolve, reject) => {
      const args = [
        "--input_path",
        inputPath,
        "--output_path",
        outputPath,
        "--paper_size",
        paperSize,
        "--ppi",
        String(ppi),
        "--quality",
        String(quality),
      ];

      let command = exePath;
      let commandArgs = args;
      let cwd = baseDir;

      // Fallback to Python script in development if the executable hasn't been built yet.
      if (!fs.existsSync(exePath)) {
        const scriptPath = path.join(
          projectRoot,
          "translated_text_boxes_to_pdf.py",
        );
        const pythonPath =
          process.platform === "win32"
            ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
            : path.join(projectRoot, ".venv", "bin", "python");

        if (!fs.existsSync(scriptPath)) {
          reject(
            `Cannot find translated_text_boxes_to_pdf.py at ${scriptPath}`,
          );
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

      let stdout = "";
      let stderr = "";
      mdProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      mdProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      mdProcess.on("error", (err) => {
        reject(`Failed to start markdown PDF process: ${err.message}`);
      });
      mdProcess.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(stderr || `Exited with code ${code}`);
        }
      });
    });
  }),
);

ipcMain.handle("get-front-images", async (event, directory) => {
  try {
    const source = selectedDirectory(directory, getFrontDir());
    watchSelectedDirectory(source, "front-images-changed", imageFilename);
    return await imageFiles(source);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
});

// Example for other directories (add similar handlers as needed):
ipcMain.handle("get-back-images", async (event, directory) => {
  try {
    const source = selectedDirectory(directory, getBackDir());
    watchSelectedDirectory(source, "back-images-changed", imageFilename);
    return await imageFiles(source);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
});
ipcMain.handle("get-double-sided-images", async (event, directory) => {
  try {
    const source = selectedDirectory(directory, getDoubleSidedDir());
    watchSelectedDirectory(
      source,
      "double-sided-images-changed",
      imageFilename,
    );
    return await imageFiles(source);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
});

ipcMain.handle("clear-double-sided-images", async (event, directory) => {
  const doubleSidedDir = selectedDirectory(directory, getDoubleSidedDir());
  try {
    if (!(await confirmImageClear(doubleSidedDir, "double-sided source")))
      return "Double-sided image clearing canceled.";
    for (const file of await imageFiles(doubleSidedDir))
      await fs.promises.unlink(path.join(doubleSidedDir, file));
    return "Double-sided images cleared.";
  } catch (err) {
    return "Error clearing images: " + err;
  }
});

ipcMain.handle("upload-double-sided-images", async (event, directory) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: [
          "png",
          "apng",
          "jpg",
          "jpeg",
          "jpx",
          "gif",
          "webp",
          "tif",
          "tiff",
          "bmp",
          "avif",
          "qoi",
          "dds",
        ],
      },
    ],
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return null;
  }
  const doubleSidedDir = selectedDirectory(directory, getDoubleSidedDir());
  try {
    await fs.promises.mkdir(doubleSidedDir, { recursive: true });
    for (const src of filePaths) {
      // Preserve original filename so it can match a front image; overwrite silently on collision.
      const destName = path.basename(src);
      await fs.promises.copyFile(src, path.join(doubleSidedDir, destName));
    }
    return filePaths.length;
  } catch (err) {
    throw new Error("Error uploading double-sided images: " + err);
  }
});

// Card lookup stays in its own worker; PDF jobs keep their existing queue.
const cardCacheRoot = path.join(getDataDir(), 'card-cache');
ipcMain.handle('card-request', async (event, payload) => jobActivity.run(async () => {
  if (!require('./updateIpc').isTrustedUpdateSender(event, path.resolve(__dirname, '..'))) throw new Error('Card commands are only available to application pages.');
  if (!payload || !['parse', 'resolve', 'release'].includes(payload.op)) throw new Error('Invalid card operation.');
  if (payload.op === 'parse' && (typeof payload.text !== 'string' || payload.text.length > 1000000)) throw new Error('Invalid deck list.');
  if (payload.op === 'release' && (!Array.isArray(payload.cacheIds) || payload.cacheIds.some(id => !/^[a-f0-9]{32}$/.test(id)))) throw new Error('Invalid card cache IDs.');
  return require('./cardWorkerClient').requestCards(payload);
}));
ipcMain.handle('card-export', async (event, { plan } = {}) => jobActivity.run(async () => {
  if (!require('./updateIpc').isTrustedUpdateSender(event, path.resolve(__dirname, '..'))) throw new Error('Card commands are only available to application pages.');
  if (!Array.isArray(plan) || !plan.length || plan.length > 10000) throw new Error('Invalid image plan.');
  const { fileURLToPath } = require('url');
  const { nativeImage } = require('electron');
  const loadImage = async image => {
    const url = typeof image === 'string' ? image : image.url;
    let bytes;
    if (typeof url !== 'string') throw new Error('Missing card image.');
    if (url.startsWith('file:')) {
      const source = fileURLToPath(url);
      if (path.dirname(path.resolve(source)) !== path.resolve(cardCacheRoot) || !/^[a-f0-9]{32}\.png$/.test(path.basename(source))) throw new Error('Invalid cached image path.');
      const real = await fs.promises.realpath(source);
      if (path.dirname(real) !== await fs.promises.realpath(cardCacheRoot)) throw new Error('Invalid cached image path.');
      bytes = await fs.promises.readFile(real);
    } else {
      const target = new URL(url);
      if (target.protocol !== 'https:' || !['cards.scryfall.io', 'api.scryfall.com'].includes(target.hostname)) throw new Error('Invalid card image URL.');
      bytes = (await require('./cardImageCache').getCardImage(url)).bytes;
    }
    const decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) throw new Error('Card image could not be decoded.');
    return decoded.toPNG();
  };
  let mode = 'add';
  const existing = [...await imageFiles(getFrontDir()), ...await imageFiles(getDoubleSidedDir())];
  if (existing.length) {
    const answer = await dialog.showMessageBox({ type: 'question', message: `${existing.length} card images already exist.`, detail: 'Replace the images or add these cards. Other files and common backs are kept.', buttons: ['Cancel', 'Replace', 'Add'], defaultId: 0, cancelId: 0 });
    if (answer.response === 0) return { canceled: true };
    mode = answer.response === 1 ? 'replace' : 'add';
  }
  return require('../shared/cardList/imageExport').exportImages({ plan, mode, frontDir: getFrontDir(), doubleSidedDir: getDoubleSidedDir(), loadImage });
}));
