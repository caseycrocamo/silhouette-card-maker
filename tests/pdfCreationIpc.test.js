const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadIpc() {
  const handlers = new Map();
  const requests = [];
  const activityCalls = [];
  const dialogCalls = [];
  const dialogState = {
    canceled: false,
    saveCanceled: false,
    confirmResponse: 1,
    savePath: "/selected/file.pdf",
    failAccess: false,
  };
  const electron = {
    app: { isPackaged: false, getPath: () => "/userdata", on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: {
      on() {},
      handle: (name, handler) => handlers.set(name, handler),
    },
    dialog: {
      showOpenDialog: async (options) => {
        dialogCalls.push(["open", options]);
        return { canceled: dialogState.canceled, filePaths: ["/selected"] };
      },
      showSaveDialog: async (options) => {
        dialogCalls.push(["save", options]);
        return {
          canceled: dialogState.saveCanceled,
          filePath: dialogState.savePath,
        };
      },
      showMessageBox: async (options) => {
        dialogCalls.push(["confirm", options]);
        return { response: dialogState.confirmResponse };
      },
    },
    shell: { openPath: async () => "" },
  };
  const fakeFs = {
    existsSync: (target) =>
      target.startsWith("/managed/") ||
      target === "/tmp/existing.pdf" ||
      target === "/tmp/folder.pdf",
    statSync: (target) => ({ isDirectory: () => target === "/tmp/folder.pdf" }),
    mkdirSync: () => {},
    watch: () => ({ close() {}, on() {} }),
    promises: {
      readdir: async (directory) => {
        requests.push(["readdir", directory]);
        return directory === "/tmp/images" || directory === "/tmp"
          ? ["page1.png", "page3.png", "keep.txt"]
          : [
              "a.png",
              "note.txt",
              "Card.JPG",
              { name: "folder", isFile: () => false },
            ];
      },
      unlink: async (file) => requests.push(["unlink", file]),
      mkdir: async () => {},
      copyFile: async (src, dest) => requests.push(["copy", src, dest]),
      access: async (src) => {
        requests.push(["access", src]);
        if (dialogState.failAccess) {
          const error = new Error("missing source");
          error.code = "ENOENT";
          throw error;
        }
      },
      readFile: async () => "{}",
      writeFile: async (file, contents) => requests.push(["write", file, contents]),
      rename: async (src, dest) => requests.push(["rename", src, dest]),
      rm: async () => {},
    },
  };
  const filename = path.resolve(__dirname, "../GUI/Utilities/ipcHandlers.js");
  const constants = {
    getFrontDir: () => "/managed/front",
    getBackDir: () => "/managed/back",
    getOutputDir: () => "/managed/output",
    getDecklistDir: () => "/managed/deck",
    getDoubleSidedDir: () => "/managed/doubles",
    getDataDir: () => "/managed/data",
    getCalibrationDir: () => "/managed/calibration",
    getGeneratedCalibrationDir: () => "/managed/generated-calibration",
  };
  const worker = {
    runCreatePdf: async (argv) => {
      requests.push(["create", argv]);
      const images = argv[0] === "--output_images";
      return {
        ok: true,
        log: "done",
        result: {
          kind: images ? "images" : "pdf",
          destination: images ? "/tmp/images" : "/x.pdf",
          files: images ? ["/tmp/images/page1.png"] : ["/x.pdf"],
        },
      };
    },
    getPdfCapabilities: async () => ({
      ok: true,
      result: { version: 1, options: [] },
    }),
    preflightCreatePdf: async (argv) => {
      requests.push(["preflight", argv]);
      return {
        ok: true,
        result: { errors: {}, warnings: [], slot_capacity: 9 },
      };
    },
    runOffsetPdf: async (values) => { requests.push(["offset", values]); return { ok: true, log: "offset" }; },
    generateCalibrationSheets: async (values) => { requests.push(["calibration", values]); return { ok: true, result: { paths: ["/tmp/letter-calibration.pdf"] } }; },
  };
  const context = {
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process,
    console,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === './parityIpc') return require('../GUI/Utilities/parityIpc');
      // The fake filesystem below uses POSIX paths on every host.
      if (name === "path") return path.posix;
      if (name === "electron") return electron;
      if (name === "fs") return fakeFs;
      if (name === "./pdfWorkerClient") return worker;
      if (name === "./templateWorkerClient") return {
        requestTemplate: async payload => {
          requests.push(['template', payload]);
          if (payload.command === 'batch_manifest') return { ok: true, items: [
            { card_size: 'one', output_path: '/tmp/one.dxf' },
            { card_size: 'two', output_path: '/tmp/two.dxf' },
          ] };
          return { ok: true, path: payload.output_path };
        },
      };
      if (name === "./updateIpc") {
        const real = require("../GUI/Utilities/updateIpc");
        // Trust checks use real file URLs and the host filesystem, unlike the
        // virtual POSIX image paths in this fixture.
        return { ...real, isTrustedUpdateSender: event => real.isTrustedUpdateSender(event, path.resolve(__dirname, "../GUI")) };
      }
      if (name === "./jobActivity")
        return { jobActivity: { run: async (fn) => {
          activityCalls.push('start');
          try { return await fn(); } finally { activityCalls.push('end'); }
        } } };
      if (name === "../shared/constants") return constants;
      if (name === "../shared/pdfCatalog.json")
        return require("../GUI/shared/pdfCatalog.json");
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context);
  return { handlers, requests, dialogCalls, dialogState, activityCalls };
}

test("PDF IPC transports argv as an array and returns structured output", async () => {
  const { handlers, requests } = loadIpc();
  const argv = [
    "--label",
    'Rāh! "Special" card',
    "--output_path",
    "/tmp/a folder/print.pdf",
  ];
  assert.equal(
    JSON.stringify(await handlers.get("run-create-pdf")({}, argv)),
    JSON.stringify({
      kind: "pdf",
      destination: "/x.pdf",
      files: ["/x.pdf"],
      log: "done",
    }),
  );
  assert.deepEqual(requests[0], ["create", argv]);
  await handlers.get("preflight-create-pdf")({}, argv);
  assert.deepEqual(requests[1], ["preflight", argv]);
  const capabilities = await handlers.get("get-pdf-capabilities")();
  assert.equal(capabilities.version, 1);
  assert.equal(capabilities.options.length, 28);
});

test("PDF IPC rejects malformed and non-allowlisted argv before worker submission", async () => {
  const { handlers, requests } = loadIpc();
  await assert.rejects(
    handlers.get("run-create-pdf")({}, "--label hi"),
    /array of text/,
  );
  await assert.rejects(
    handlers.get("preflight-create-pdf")({}, ["--unknown", "x"]),
    /Invalid PDF option/,
  );
  await assert.rejects(
    handlers.get("run-create-pdf")({}, ["--label"]),
    /missing value/,
  );
  await assert.rejects(
    handlers.get("run-create-pdf")({}, ["--label", "bad\0value"]),
    /array of text/,
  );
  await assert.rejects(
    handlers.get("run-create-pdf")({}, ["--label", "ok", "--unknown", "no"]),
    /Invalid PDF option/,
  );
  assert.equal(requests.length, 0);
});

test("PDF overwrite dialog can cancel or redirect to the newly selected path", async () => {
  const { handlers, requests, dialogCalls, dialogState } = loadIpc();
  const argv = [
    "--output_path",
    "/tmp/existing.pdf",
    "--label",
    "--output_images",
  ];
  dialogState.saveCanceled = true;
  assert.equal(
    JSON.stringify(await handlers.get("run-create-pdf")({}, argv)),
    '{"canceled":true}',
  );
  assert.equal(
    requests.some(([name]) => name === "create"),
    false,
  );
  dialogState.saveCanceled = false;
  dialogState.savePath = "/tmp/a newly selected.pdf";
  const result = await handlers.get("run-create-pdf")({}, argv);
  assert.equal(result.kind, "pdf");
  assert.deepEqual(requests.find(([name]) => name === "create")[1], [
    "--output_path",
    "/tmp/a newly selected.pdf",
    "--label",
    "--output_images",
  ]);
  assert.equal(dialogCalls[0][0], "save");
  assert.equal(dialogCalls[0][1].defaultPath, "/tmp/existing.pdf");
});

test("existing default PDF output also uses the native save dialog", async () => {
  const { handlers, dialogCalls } = loadIpc();
  await handlers.get("run-create-pdf")({}, []);
  assert.equal(dialogCalls[0][0], "save");
  assert.equal(dialogCalls[0][1].defaultPath, "/managed/output/game.pdf");
});

test("PNG overwrite confirmation cancels safely and preserves unrelated and stale files", async () => {
  const { handlers, requests, dialogCalls, dialogState } = loadIpc();
  const argv = ["--output_images", "--output_path", "/tmp/images"];
  dialogState.confirmResponse = 0;
  assert.equal(
    JSON.stringify(await handlers.get("run-create-pdf")({}, argv)),
    '{"canceled":true}',
  );
  assert.equal(
    requests.some(([name]) => name === "create"),
    false,
  );
  dialogState.confirmResponse = 1;
  const result = await handlers.get("run-create-pdf")({}, argv);
  assert.equal(result.kind, "images");
  assert.equal(dialogCalls.filter(([kind]) => kind === "confirm").length, 2);
  assert.equal(requests.filter(([name]) => name === "unlink").length, 0);
});

test("flag-like label values do not change output routing", async () => {
  const { handlers, requests, dialogCalls } = loadIpc();
  const argv = ["--label", "--output_images", "--output_path", "/tmp/new.pdf"];
  const result = await handlers.get("run-create-pdf")({}, argv);
  assert.equal(result.kind, "pdf");
  assert.deepEqual(requests.find(([name]) => name === "create")[1], argv);
  assert.equal(
    dialogCalls.some(([kind]) => kind === "confirm"),
    false,
  );
});

test("PNG destination resolves legacy PDF-like paths and preserves existing PDF-named folders", async () => {
  const { handlers, requests } = loadIpc();
  await handlers.get("run-create-pdf")({}, [
    "--output_images",
    "--output_path",
    "/tmp/legacy.pdf",
  ]);
  assert.equal(
    requests.some(
      ([name, directory]) => name === "readdir" && directory === "/tmp",
    ),
    true,
  );
  const { handlers: directoryHandlers, requests: directoryRequests } =
    loadIpc();
  await directoryHandlers.get("run-create-pdf")({}, [
    "--output_images",
    "--output_path",
    "/tmp/folder.pdf",
  ]);
  assert.equal(
    directoryRequests.some(
      ([name, directory]) =>
        name === "readdir" && directory === "/tmp/folder.pdf",
    ),
    true,
  );
});

test("source list and clear handlers use the selected directory", async () => {
  const { handlers, requests } = loadIpc();
  assert.equal(
    JSON.stringify(
      await handlers.get("get-front-images")({}, "/tmp/front files"),
    ),
    JSON.stringify(["a.png", "Card.JPG"]),
  );
  await handlers.get("clear-front-images")({}, "/tmp/front files");
  assert.deepEqual(requests.slice(0, 2), [
    ["readdir", "/tmp/front files"],
    ["readdir", "/tmp/front files"],
  ]);
  assert.deepEqual(requests[2], ["unlink", "/tmp/front files/a.png"]);
  assert.deepEqual(requests[3], ["unlink", "/tmp/front files/Card.JPG"]);
});

test("back image replacement validates source and copies it before clearing selected images", async () => {
  const { handlers, requests } = loadIpc();
  assert.equal(
    await handlers.get("select-back-image")({}, "/tmp/custom back"),
    "back.png",
  );
  const access = requests.findIndex(([name]) => name === "access");
  const copy = requests.findIndex(([name]) => name === "copy");
  const remove = requests.findIndex(([name]) => name === "unlink");
  assert.ok(access >= 0 && copy > access && remove > copy);
  assert.deepEqual(requests[copy], [
    "copy",
    "/selected",
    "/tmp/custom back/back.png",
  ]);
  assert.deepEqual(
    requests.filter(([name]) => name === "unlink").map(([, file]) => file),
    ["/tmp/custom back/a.png", "/tmp/custom back/Card.JPG"],
  );
  assert.equal(
    requests.some(
      ([name, file]) => name === "unlink" && file.endsWith("note.txt"),
    ),
    false,
  );
});

test("missing replacement source fails before selected images can be removed", async () => {
  const { handlers, requests, dialogState } = loadIpc();
  dialogState.failAccess = true;
  await assert.rejects(
    handlers.get("select-back-image")({}, "/tmp/custom back"),
    /missing source/,
  );
  assert.equal(
    requests.some(
      ([name]) => name === "copy" || name === "unlink" || name === "readdir",
    ),
    false,
  );
});

test("invalid selected source paths reject instead of appearing as empty folders", async () => {
  const { handlers } = loadIpc();
  await assert.rejects(
    handlers.get("get-front-images")({}, "relative/folder"),
    /absolute path/,
  );
});

test("path picker supports directory and PDF modes and preserves cancellation", async () => {
  const { handlers, dialogCalls, dialogState } = loadIpc();
  assert.equal(
    await handlers.get("select-pdf-setting-path")(
      {},
      { kind: "directory", defaultPath: "/tmp" },
    ),
    "/selected",
  );
  assert.equal(
    await handlers.get("select-pdf-setting-path")(
      {},
      { kind: "pdf", defaultPath: "/tmp/out.pdf" },
    ),
    "/selected/file.pdf",
  );
  assert.equal(
    JSON.stringify(dialogCalls[0][1].properties),
    JSON.stringify(["openDirectory", "createDirectory"]),
  );
  assert.equal(
    JSON.stringify(dialogCalls[1][1].filters),
    JSON.stringify([{ name: "PDF", extensions: ["pdf"] }]),
  );
  dialogState.canceled = true;
  assert.equal(
    await handlers.get("select-pdf-setting-path")({}, { kind: "directory" }),
    null,
  );
  dialogState.saveCanceled = true;
  assert.equal(
    await handlers.get("select-pdf-setting-path")({}, { kind: "pdf" }),
    null,
  );
  await assert.rejects(
    handlers.get("select-pdf-setting-path")({}, { kind: "bad" }),
    /directory or pdf/,
  );
});

test("canceling replacement leaves existing images and selected source unchanged", async () => {
  const { handlers, requests, dialogState } = loadIpc();
  dialogState.confirmResponse = 0;
  assert.equal(
    await handlers.get("select-back-image")({}, "/tmp/custom back"),
    null,
  );
  assert.equal(
    requests.some(([name]) => name === "copy" || name === "unlink"),
    false,
  );
});

test("settings catalog is available without calling or waiting for the PDF worker", async () => {
  const { handlers, requests } = loadIpc();
  const catalog = await handlers.get("get-pdf-capabilities")();
  assert.ok(catalog.layouts[0].variants[0].preview.width > 0);
  assert.equal(requests.length, 0);
});


test("card IPC rejects non-app callers before lookup or export", async () => {
  const { handlers } = loadIpc();
  await assert.rejects(handlers.get("card-request")({}, {op:"parse", text:"x"}), /application pages/);
  await assert.rejects(handlers.get("card-export")({}, {plan:[]}), /application pages/);
});
test("card IPC validates payload and cancel preserves existing images", async () => {
  const { handlers, requests, dialogState } = loadIpc();
  const frame={url:require('node:url').pathToFileURL(path.resolve(__dirname,'../GUI/CardList/decklist.html')).href};
  const event={senderFrame:frame,sender:{mainFrame:frame,isDestroyed:()=>false}};
  await assert.rejects(handlers.get("card-request")(event, {op:"bad"}), /Invalid card operation/);
  await assert.rejects(handlers.get("card-request")(event, {op:"release",cacheIds:["../bad"]}), /Invalid card cache/);
  dialogState.confirmResponse=0;
  const result=await handlers.get("card-export")(event,{plan:[{name:"Pikachu",front:{url:"file:///bad.png"}}]});
  assert.equal(result.canceled,true);
  assert.equal(requests.some(([op])=>op==='unlink'||op==='copy'),false);
});

function featureEvent() {
  const frame = { url: require('node:url').pathToFileURL(path.resolve(__dirname, '../GUI/Settings/settings.html')).href };
  return { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
}
test('offset IPC preserves rotation, PPI, output path, and zero overrides', async () => {
  const { handlers, requests } = loadIpc();
  const result = await handlers.get('run-offset-pdf')(featureEvent(), {
    pdfPath: '/tmp/in.pdf', outputPdfPath: '/tmp/out.pdf', angle: -0.25,
    xOffset: 0, yOffset: -3, ppi: 150, save: false,
  });
  assert.equal(result, 'offset');
  const values = requests.find(row => row[0] === 'offset')[1];
  assert.equal(values.angle, -0.25);
  assert.equal(values.xOffset, 0);
  assert.equal(values.yOffset, -3);
  assert.equal(values.ppi, 150);
  assert.equal(values.outputPdfPath, '/tmp/out.pdf');
  assert.equal(values.save, false);
});
test('offset IPC rejects invalid numeric values and untrusted pages before processing', async () => {
  const { handlers, requests } = loadIpc();
  for (const invalid of [{ angle: Infinity }, { ppi: 0 }, { ppi: 1.5 }, { xOffset: 0.5 }, { save: 'yes' }])
    await assert.rejects(handlers.get('run-offset-pdf')(featureEvent(), { pdfPath: '/tmp/in.pdf', ...invalid }), /Invalid/);
  await assert.rejects(handlers.get('run-offset-pdf')({}, { pdfPath: '/tmp/in.pdf' }), /application pages/);
  assert.ok(!requests.some(row => row[0] === 'offset'));
});
test('saved offsets use atomic replacement and retain explicit zero angle', async () => {
  const { handlers, requests } = loadIpc();
  const result = await handlers.get('save-offset-data')(featureEvent(), { x_offset: 0, y_offset: -1, angle_offset: 0 });
  assert.equal(result.angle_offset, 0);
  assert.equal(result.y_offset, -1);
  assert.ok(requests.some(row => row[0] === 'rename' && row[2].endsWith('/offset_data.json')));
});
test('calibration IPC uses a writable output folder and returns paths', async () => {
  const { handlers, requests } = loadIpc();
  const result = await handlers.get('generate-calibration-sheets')(featureEvent(), { paperSizes: ['letter'], ppi: 150 });
  assert.equal(result.paths[0], '/tmp/letter-calibration.pdf');
  assert.equal(requests.find(row => row[0] === 'calibration')[1].outputDir, '/managed/generated-calibration');
  await assert.rejects(handlers.get('generate-calibration-sheets')(featureEvent(), { paperSizes: 'letter' }), /Invalid paper/);
});
test('template IPC blocks unsupported operations and untrusted senders', async () => {
  const { handlers } = loadIpc();
  await assert.rejects(handlers.get('template-request')({}, { command: 'list' }), /application pages/);
  await assert.rejects(handlers.get('template-request')(featureEvent(), { command: 'delete' }), /Invalid template/);
});

test('a template batch holds one activity job and cancels between items', async () => {
  const { handlers, requests, activityCalls } = loadIpc();
  const event = featureEvent();
  const sender = new (require('node:events'))();
  Object.assign(sender, event.sender);
  event.sender = sender;
  const progress = [];
  sender.send = (_channel, update) => {
    progress.push(update);
    handlers.get('cancel-template-request')(event);
  };
  const result = await handlers.get('template-batch')(event, { mode: 'all', output_dir: '/tmp' });
  assert.equal(result.canceled, true);
  assert.equal(result.completed, 1);
  assert.equal(result.total, 2);
  assert.equal(progress.length, 1);
  assert.equal(requests.filter(row => row[0] === 'template' && row[1].command === 'single').length, 1);
  assert.deepEqual(activityCalls, ['start', 'end']);
  assert.equal(sender.listenerCount('did-start-navigation'), 0);
});
