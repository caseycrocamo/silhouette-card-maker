'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUpdateService, detectInstallTarget, FIRST_CHECK_DELAY } = require('../GUI/Utilities/updateService');

async function fixture(overrides = {}) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scm-update-'));
  const image = path.join(directory, 'application.AppImage');
  await fs.promises.writeFile(image, 'mock');
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({ updateInfo: { version: '1.2.0', releaseNotes: 'Release notes' } });
  updater.downloadUpdate = async () => { updater.emit('update-downloaded', { version: '1.2.0' }); };
  updater.quitAndInstall = async () => {};
  const app = { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory };
  const service = createUpdateService({ app, updater, platform: 'linux', env: { APPIMAGE: image }, logger: { warn() {} }, ...overrides });
  return { directory, image, updater, service };
}

test('updater is configured for explicit download and install, with progress state', async (t) => {
  const { directory, updater, service } = await fixture();
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  await service.checkForUpdates();
  assert.equal(service.getState().status, 'available');
  assert.equal(service.getState().availableVersion, '1.2.0');
  await service.downloadUpdate();
  assert.equal(service.getState().status, 'ready-to-install');
  await service.installUpdate();
  assert.equal(service.getState().status, 'installing');
});

test('manual checks join an in-flight check and preference changes persist', async (t) => {
  const { directory, updater, service } = await fixture();
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  let resolve;
  let calls = 0;
  updater.checkForUpdates = () => { calls += 1; return new Promise((r) => { resolve = r; }); };
  await service.start();
  const a = service.checkForUpdates();
  const b = service.checkForUpdates();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  resolve({ updateInfo: { version: '1.2.0' } });
  await Promise.all([a, b]);
  await service.setAutomaticChecks(false);
  const saved = JSON.parse(await fs.promises.readFile(path.join(directory, 'update-preferences.json'), 'utf8'));
  assert.equal(saved.automaticChecks, false);
  assert.equal(service.getState().automaticChecks, false);
});

test('manual fallback reports stable releases and never claims in-app installation', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scm-update-'));
  const app = { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory };
  const service = createUpdateService({
    app, platform: 'darwin', arch: 'x64', releaseRequest: async () => [{
      tag_name: 'v1.2.0', draft: false, prerelease: false, body: 'Notes',
      assets: [{ name: 'Silhouette-Card-Maker-1.2.0-mac-x64.dmg' }],
    }],
    logger: { warn() {} },
  });
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  await service.checkForUpdates();
  assert.equal(service.getState().status, 'available');
  assert.equal(service.getState().canInstall, false);
  assert.equal(service.getState().releaseNotes, 'Notes');
});

test('install preparation failure releases the job lock and exposes a safe error', async (t) => {
  const { directory, updater, service } = await fixture({
    prepareInstall: async () => { throw new Error('busy; https://private.example/job/1'); },
  });
  let cancelled = 0;
  service.stop();
  const replacement = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory }, updater,
    platform: 'linux', env: { APPIMAGE: path.join(directory, 'application.AppImage') },
    prepareInstall: async () => { throw new Error('busy; https://private.example/job/1'); },
    cancelInstall: async () => { cancelled += 1; }, logger: { warn() {} },
  });
  t.after(async () => { await replacement.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await replacement.start();
  await replacement.checkForUpdates();
  await replacement.downloadUpdate();
  await assert.rejects(replacement.installUpdate());
  assert.equal(cancelled, 1);
  assert.equal(replacement.getState().status, 'ready-to-install');
  assert.match(replacement.getState().error, /busy/);
  assert.equal(replacement.getState().error.includes('private.example'), false);
});

test('scheduled startup check is delayed, failures stay errors, and disabling checks clears timers', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scm-update-'));
  const image = path.join(directory, 'app.AppImage');
  await fs.promises.writeFile(image, 'mock');
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { throw new Error('offline'); };
  const timers = new Map();
  let nextTimer = 0;
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory }, updater,
    platform: 'linux', env: { APPIMAGE: image }, logger: { warn() {} },
    now: () => 1_700_000_000_000,
    setTimeoutFn: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeoutFn: (id) => timers.delete(id), setIntervalFn: () => 0, clearIntervalFn: () => {},
  });
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  assert.equal([...timers.values()][0].ms, FIRST_CHECK_DELAY);
  const state = await service.checkForUpdates();
  assert.equal(state.status, 'error');
  assert.notEqual(state.status, 'up-to-date');
  assert.equal([...timers.values()][0].ms, 30_000);
  await service.setAutomaticChecks(false);
  assert.equal(timers.size, 0);
  // Manual checks remain available after automatic checks are disabled.
  assert.equal((await service.checkForUpdates()).status, 'error');
});

test('Windows in-app capability requires an installed NSIS shape, not just Windows', () => {
  const fakeFs = {
    constants: { W_OK: 2 },
    readdirSync: () => ['Silhouette Card Maker.exe', 'Uninstall Silhouette Card Maker.exe'],
    existsSync: () => true,
    accessSync: () => {},
  };
  assert.equal(detectInstallTarget({ platform: 'win32', execPath: 'C:/App/Silhouette.exe', resourcesPath: 'C:/App/resources', env: {}, fileSystem: fakeFs, pathModule: path }).canInstall, true);
  fakeFs.readdirSync = () => ['Silhouette Card Maker.exe'];
  assert.equal(detectInstallTarget({ platform: 'win32', execPath: 'C:/App/Silhouette.exe', resourcesPath: 'C:/App/resources', env: {}, fileSystem: fakeFs, pathModule: path }).canInstall, false);
  assert.equal(detectInstallTarget({ platform: 'linux', execPath: '/opt/app', env: {}, fileSystem: fakeFs, pathModule: path }).canInstall, false);
});

test('download cancellation uses the updater CancellationToken and leaves the update available', async (t) => {
  const { directory, updater, service } = await fixture();
  let receivedToken;
  updater.downloadUpdate = (token) => {
    receivedToken = token;
    return new Promise((resolve, reject) => token.once('cancel', () => reject(Object.assign(new Error('cancelled'), { name: 'CancellationError' }))));
  };
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  await service.checkForUpdates();
  const download = service.downloadUpdate();
  await service.cancelDownload();
  await download;
  assert.equal(receivedToken.cancelled, true);
  assert.equal(service.getState().status, 'available');
});

test('asynchronous updater install errors release the job lock and restore retryable state', async (t) => {
  const { directory, updater, service } = await fixture();
  let cancelled = 0;
  const replacement = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory }, updater,
    platform: 'linux', env: { APPIMAGE: path.join(directory, 'application.AppImage') },
    cancelInstall: async () => { cancelled += 1; }, logger: { warn() {} },
  });
  service.stop();
  t.after(async () => { await replacement.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await replacement.start();
  await replacement.checkForUpdates();
  await replacement.downloadUpdate();
  await replacement.installUpdate();
  updater.emit('error', new Error('installer failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
  assert.equal(replacement.getState().status, 'ready-to-install');
  assert.match(replacement.getState().error, /installer failed/);
});

test('fallback requires the exact OS and architecture artifact', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scm-update-'));
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory },
    platform: 'darwin', arch: 'arm64', logger: { warn() {} },
    releaseRequest: async () => [{ tag_name: 'v1.2.0', draft: false, prerelease: false, assets: [{ name: 'Silhouette-Card-Maker-1.2.0-mac-x64.dmg' }] }],
  });
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  const result = await service.checkForUpdates();
  assert.equal(result.status, 'error');
  assert.match(result.error, /no compatible download/i);
});

test('invalid preferences recover to defaults and Later suppresses that version for 24 hours', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scm-update-'));
  await fs.promises.writeFile(path.join(directory, 'update-preferences.json'), '{invalid');
  let time = Date.now();
  const app = { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory };
  const opts = {
    app, platform: 'darwin', arch: 'arm64', now: () => time, logger: { warn() {} },
    releaseRequest: async () => [{
      tag_name: 'v1.2.0', draft: false, prerelease: false,
      assets: [{ name: 'Silhouette-Card-Maker-1.2.0-mac-arm64.dmg' }],
    }],
  };
  const first = createUpdateService(opts);
  t.after(async () => { await first.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await first.start();
  assert.equal(first.getState().automaticChecks, true);
  await first.checkForUpdates();
  assert.equal(first.getState().notificationVisible, true);
  await first.dismissUpdate();
  await first.stop();
  const second = createUpdateService(opts);
  await second.start();
  await second.checkForUpdates();
  assert.equal(second.getState().notificationVisible, false);
  time += 24 * 60 * 60 * 1000 + 1;
  await second.checkForUpdates();
  assert.equal(second.getState().notificationVisible, true);
  await second.stop();
});

test('retry-after is honored on manual retries and development builds schedule no checks', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scm-update-'));
  const image = path.join(directory, 'app.AppImage');
  await fs.promises.writeFile(image, 'mock');
  const timers = new Map();
  let timerId = 0;
  let calls = 0;
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    calls += 1;
    throw Object.assign(new Error('limited'), { retryAfterMs: 60_000 });
  };
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory }, updater,
    platform: 'linux', env: { APPIMAGE: image }, now: () => 1_700_000_000_000, logger: { warn() {} },
    setTimeoutFn: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeoutFn: (id) => timers.delete(id),
  });
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  await service.checkForUpdates();
  assert.equal([...timers.values()][0].ms, 60_000);
  await service.checkForUpdates();
  assert.equal(calls, 1);

  const devTimers = new Map();
  const development = createUpdateService({
    app: { isPackaged: false, getVersion: () => '1.1.0', getPath: () => directory },
    setTimeoutFn: (fn, ms) => { devTimers.set(1, { fn, ms }); return 1; }, clearTimeoutFn: () => {},
  });
  t.after(async () => { await development.stop(); });
  await development.start();
  assert.equal(devTimers.size, 0);
  assert.equal(development.getState().canInstall, false);
});

test('missing metadata and stalled updater requests become errors instead of remaining checking', async (t) => {
  const { directory, updater, service } = await fixture();
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  updater.checkForUpdates = async () => null;
  assert.equal((await service.checkForUpdates()).status, 'error');
  assert.equal(service.getState().status, 'error');
  await service.stop();

  const second = await fixture({ networkTimeoutMs: 5 });
  second.updater.checkForUpdates = () => new Promise(() => {});
  t.after(async () => { await second.service.stop(); fs.rmSync(second.directory, { recursive: true, force: true }); });
  await second.service.start();
  const result = await second.service.checkForUpdates();
  assert.equal(result.status, 'error');
  assert.match(result.error, /timed out/i);
});

test('preference save failures stay visible while the session toggle remains changed', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scm-update-'));
  const fileSystem = {
    constants: fs.constants,
    readdirSync: (...args) => fs.readdirSync(...args),
    existsSync: (...args) => fs.existsSync(...args),
    accessSync: (...args) => fs.accessSync(...args),
    promises: {
    ...fs.promises,
    writeFile: async () => { throw new Error('disk full'); },
    },
  };
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory },
    platform: 'darwin', fileSystem, logger: { warn() {} },
  });
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  const result = await service.setAutomaticChecks(false);
  assert.equal(result.automaticChecks, false);
  assert.match(result.error, /could not save update preferences: disk full/i);
});

test('download completion without the verified event stays retryable and stopped service does not check again', async (t) => {
  const { directory, updater, service } = await fixture();
  updater.downloadUpdate = async () => {};
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.start();
  await service.checkForUpdates();
  const result = await service.downloadUpdate();
  assert.equal(result.status, 'available');
  assert.match(result.error, /without verifying/i);

  let calls = 0;
  const fallback = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.1.0', getPath: () => directory },
    platform: 'darwin', releaseRequest: async () => { calls += 1; return []; }, logger: { warn() {} },
  });
  await fallback.start();
  await fallback.stop();
  await fallback.checkForUpdates();
  assert.equal(calls, 0);
  await fallback.stop();
});
