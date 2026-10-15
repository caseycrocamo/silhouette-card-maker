'use strict';

// Run through Electron on Windows after `GUI/dist/latest.yml` has been built:
// node GUI/node_modules/electron/cli.js tests/update-download-smoke.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const yaml = require('../GUI/node_modules/js-yaml');
const { app } = require('electron');
const { NsisUpdater } = require('../GUI/node_modules/electron-updater');
const { ElectronHttpExecutor } = require('../GUI/node_modules/electron-updater/out/electronHttpExecutor');
const { createUpdateService } = require('../GUI/Utilities/updateService');

async function run() {
  if (process.platform !== 'win32') throw new Error('The NSIS download smoke test must run on Windows.');
  const dist = path.resolve(__dirname, '../GUI/dist');
  const metadataBytes = await fs.promises.readFile(path.join(dist, 'latest.yml'));
  const metadata = yaml.load(metadataBytes.toString('utf8'));
  const expectedVersion = require('../GUI/package.json').version;
  if (!metadata || metadata.version !== expectedVersion || !Array.isArray(metadata.files)) throw new Error('latest.yml does not match GUI/package.json.');
  const installerEntry = metadata.files.find((file) => file && typeof file.url === 'string' && file.url.endsWith('-win-x64.exe'));
  if (!installerEntry || path.basename(installerEntry.url) !== installerEntry.url) throw new Error('latest.yml does not reference a safe Windows x64 NSIS installer.');
  const installerPath = path.join(dist, installerEntry.url);
  const installerStat = await fs.promises.stat(installerPath);
  if (installerStat.size !== installerEntry.size) throw new Error('The NSIS installer size does not match latest.yml.');

  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scm-updater-smoke-'));
  const appDirectory = path.join(temporaryRoot, 'installed-app');
  const resourcesPath = path.join(dist, 'win-unpacked', 'resources');
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const cachePath = path.join(temporaryRoot, 'updater-cache');
  await fs.promises.mkdir(appDirectory, { recursive: true });
  await fs.promises.writeFile(path.join(appDirectory, 'Uninstall Silhouette Card Maker.exe'), 'fixture');
  if (!fs.existsSync(path.join(resourcesPath, 'app.asar'))) throw new Error('The packaged Windows app.asar is missing.');

  let server;
  let service;
  let exitCode = 0;
  const hardTimeout = setTimeout(() => {
    console.error('Updater smoke exceeded its 120 second hard timeout.');
    if (server && typeof server.closeAllConnections === 'function') server.closeAllConnections();
    if (service) void service.cancelDownload();
    app.exit(1);
  }, 120_000);
  try {
    server = http.createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname.slice(1));
      console.log(`Loopback updater request: ${name}`);
      if (name === 'latest.yml') {
        response.writeHead(200, { 'content-type': 'text/yaml', 'content-length': metadataBytes.length });
        response.end(metadataBytes);
        return;
      }
      if (name === installerEntry.url) {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': installerStat.size });
        fs.createReadStream(installerPath).pipe(response);
        return;
      }
      response.writeHead(404);
      response.end('Not found');
    });
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    const feedUrl = `http://127.0.0.1:${server.address().port}/`;
    const appAdapter = {
      version: '0.0.1', name: 'Silhouette Card Maker', isPackaged: true,
      appUpdateConfigPath: path.join(temporaryRoot, 'app-update.yml'),
      userDataPath, baseCachePath: cachePath,
      whenReady: () => Promise.resolve(), relaunch() {}, quit() {}, onQuit(handler) { quitHandlers.push(handler); },
    };
    await fs.promises.writeFile(appAdapter.appUpdateConfigPath, `provider: generic\nurl: ${feedUrl}\n`);

    const updater = new NsisUpdater(undefined, appAdapter);
    updater.httpExecutor = new ElectronHttpExecutor();
    updater.setFeedURL({ provider: 'generic', url: feedUrl });
    updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('update-available', info => console.log(`Updater event: update-available ${info.version}`));
    updater.on('update-not-available', info => console.log(`Updater event: update-not-available ${info && info.version}`));
    updater.on('error', error => console.error(`Updater event: ${error.stack || error}`));
    let downloads = 0;
    let installs = 0;
    const quitHandlers = [];
    const realDownload = updater.downloadUpdate.bind(updater);
    updater.downloadUpdate = (...args) => { downloads += 1; return realDownload(...args); };
    updater.quitAndInstall = () => { installs += 1; };

    service = createUpdateService({
      app: { isPackaged: true, getVersion: () => appAdapter.version, getPath: () => userDataPath },
      updater, platform: 'win32', arch: 'x64', execPath: path.join(appDirectory, 'Silhouette Card Maker.exe'),
      resourcesPath, env: {}, logger: { warn() {} },
    });
    await service.start();
    await service.setAutomaticChecks(false);
    if (!service.getState().canInstall || service.targetKind !== 'nsis') throw new Error(`NSIS fixture was not detected: ${service.targetKind} (canInstall=${service.getState().canInstall})`);
    const checked = await service.checkForUpdates();
    if (checked.status !== 'available' || checked.availableVersion !== expectedVersion) throw new Error(`Real updater did not discover ${expectedVersion}: ${checked.status} ${checked.error || ''} (updater current=${updater.currentVersion.format()}, service current=${service.getState().currentVersion})`);
    if (downloads !== 0) throw new Error('The updater downloaded without explicit user action.');
    if (installs !== 0) throw new Error('The updater attempted installation during discovery.');
    if (updater.autoInstallOnAppQuit !== false) throw new Error('Automatic installation on ordinary quit is enabled.');

    await service.downloadUpdate();
    const ready = service.getState();
    if (ready.status !== 'ready-to-install') throw new Error(`Real updater download did not finish safely: ${ready.status} ${ready.error || ''}`);
    if (downloads !== 1 || installs !== 0) throw new Error('Explicit download/install boundaries were not respected.');
    if (quitHandlers.length !== 0) throw new Error('Updater registered automatic installation on ordinary quit.');
    const downloadedPath = updater.downloadedUpdateHelper && updater.downloadedUpdateHelper.file;
    if (!downloadedPath || !downloadedPath.startsWith(cachePath)) throw new Error('Downloaded installer is outside the isolated updater cache.');
    const actualHash = await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha512');
      const stream = fs.createReadStream(downloadedPath);
      stream.on('data', chunk => hash.update(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolve(hash.digest('base64')));
    });
    if (actualHash !== installerEntry.sha512) throw new Error('Downloaded installer checksum differs from the published metadata.');
    console.log(`Updater smoke passed: ${expectedVersion} discovered and SHA-512-verified; no automatic download or install.`);
  } catch (error) {
    exitCode = 1;
    console.error(`Updater smoke failed: ${error.stack || error}`);
  } finally {
    clearTimeout(hardTimeout);
    if (service) await service.stop();
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(`Updater smoke failed before setup: ${error.stack || error}`);
  app.exit(1);
});
