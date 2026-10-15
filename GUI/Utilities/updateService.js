'use strict';

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const semver = require('semver');
const {
  RELEASES_URL, findLatestCompatibleRelease, requestReleases,
} = require('./releaseProvider');

const DAY = 24 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY = 12_000;
const NETWORK_TIMEOUT = 20_000;
const STATUS = new Set(['idle', 'checking', 'up-to-date', 'available', 'downloading', 'ready-to-install', 'installing', 'error']);

function safeError(error) {
  return String(error && error.message || 'Update operation failed')
    .replace(/https?:\/\/\S+/gi, 'the update service').slice(0, 240);
}

function detectInstallTarget({ platform, execPath, env, resourcesPath, fileSystem, pathModule }) {
  if (platform === 'win32') {
    const dir = pathModule.dirname(execPath || '');
    let names;
    try { names = fileSystem.readdirSync(dir); } catch (_) { return { canInstall: false, kind: 'manual' }; }
    const uninstaller = names.some((name) => /^uninstall.*\.exe$/i.test(name));
    const appAsar = fileSystem.existsSync(pathModule.join(resourcesPath || pathModule.join(dir, 'resources'), 'app.asar'));
    return { canInstall: Boolean(uninstaller && appAsar), kind: uninstaller && appAsar ? 'nsis' : 'manual' };
  }
  if (platform === 'linux' && env && env.APPIMAGE) {
    try {
      fileSystem.accessSync(env.APPIMAGE, fileSystem.constants.W_OK);
      fileSystem.accessSync(pathModule.dirname(env.APPIMAGE), fileSystem.constants.W_OK);
      return { canInstall: true, kind: 'appimage' };
    } catch (_) { return { canInstall: false, kind: 'manual-appimage' }; }
  }
  return { canInstall: false, kind: 'manual' };
}

function createUpdateService(options = {}) {
  const {
    app, updater, shell, prepareInstall = async () => {}, cancelInstall = async () => {},
    platform = process.platform, arch = process.arch, resourcesPath = process.resourcesPath,
    execPath = process.execPath, env = process.env, fileSystem = fs, pathModule = path,
    now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
    releaseRequest = requestReleases, logger = console,
    networkTimeoutMs = NETWORK_TIMEOUT,
    makeCancellationToken = () => {
      const { CancellationToken } = require('electron-updater');
      return new CancellationToken();
    },
  } = options;
  const emitter = new EventEmitter();
  const enabled = Boolean(app && app.isPackaged);
  const target = detectInstallTarget({ platform, execPath, env, resourcesPath, fileSystem, pathModule });
  const currentVersion = app && app.getVersion ? app.getVersion() : '0.0.0';
  const userData = app && app.getPath ? app.getPath('userData') : process.cwd();
  const preferencesFile = pathModule.join(userData, 'update-preferences.json');
  const state = {
    status: 'idle', currentVersion, availableVersion: null, automaticChecks: true,
    lastCheckedAt: null, releaseNotes: '', progress: 0,
    canInstall: enabled && target.canInstall, error: null, notificationVisible: false,
    enabled, releaseUrl: RELEASES_URL,
  };
  let prefs = { automaticChecks: true, lastCheckedAt: null, dismissedVersions: {}, failures: 0, retryAt: null };
  let started = false;
  let stopped = false;
  let timer = null;
  let operation = null;
  let checkPromise = null;
  let checkGeneration = 0;
  let downloadToken = null;
  let persistenceQueue = Promise.resolve();
  let readyPromise = null;
  let persistenceSequence = 0;
  let installFailureHandled = false;
  let persistenceError = null;
  const updaterHandlers = [];

  const snapshot = () => ({ ...state });
  const publish = (changes = {}) => {
    Object.assign(state, changes);
    if (!STATUS.has(state.status)) state.status = 'error';
    emitter.emit('state-changed', snapshot());
  };
  const persist = () => {
    const serialized = JSON.stringify(prefs);
    const sequence = ++persistenceSequence;
    const write = async () => {
      let temp;
      try {
        await fileSystem.promises.mkdir(userData, { recursive: true });
        temp = `${preferencesFile}.${process.pid}.${sequence}.${crypto.randomBytes(6).toString('hex')}.tmp`;
        await fileSystem.promises.writeFile(temp, serialized, { mode: 0o600 });
        await fileSystem.promises.rename(temp, preferencesFile);
        persistenceError = null;
        return true;
      } catch (error) {
        if (temp) { try { await fileSystem.promises.unlink(temp); } catch (_) {} }
        logger.warn('Unable to save update preferences:', safeError(error));
        persistenceError = safeError(error);
        return false;
      }
    };
    const result = persistenceQueue.then(write, write);
    persistenceQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const loadPrefs = async () => {
    try {
      const parsed = JSON.parse(await fileSystem.promises.readFile(preferencesFile, 'utf8'));
      prefs = {
        automaticChecks: typeof parsed.automaticChecks === 'boolean' ? parsed.automaticChecks : true,
        lastCheckedAt: typeof parsed.lastCheckedAt === 'string' ? parsed.lastCheckedAt : null,
        dismissedVersions: parsed.dismissedVersions && typeof parsed.dismissedVersions === 'object' && !Array.isArray(parsed.dismissedVersions) ? parsed.dismissedVersions : {},
        failures: Number.isInteger(parsed.failures) && parsed.failures >= 0 ? Math.min(parsed.failures, 8) : 0,
        retryAt: typeof parsed.retryAt === 'number' ? parsed.retryAt : null,
      };
    } catch (_) {
      prefs = { automaticChecks: true, lastCheckedAt: null, dismissedVersions: {}, failures: 0, retryAt: null };
    }
    publish({ automaticChecks: prefs.automaticChecks, lastCheckedAt: prefs.lastCheckedAt });
  };
  const ensureReady = () => readyPromise || start();
  const shouldNotify = (version) => {
    if (!version) return false;
    const dismissed = prefs.dismissedVersions[version];
    return !dismissed || now() - dismissed >= DAY;
  };
  const markChecked = async () => {
    prefs.failures = 0; prefs.retryAt = null; prefs.lastCheckedAt = new Date(now()).toISOString();
    const saved = await persist();
    return {
      lastCheckedAt: prefs.lastCheckedAt,
      error: saved ? null : `Could not save update preferences: ${persistenceError}`,
    };
  };
  const fail = async (error, { retainReady = false, retainAvailable = false } = {}) => {
    if (!retainReady) {
      prefs.failures = Math.min(8, prefs.failures + 1);
      const headerDelay = Number(error && error.retryAfterMs) || 0;
      const backoff = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.max(0, prefs.failures - 1)));
      prefs.retryAt = now() + Math.min(DAY, headerDelay || backoff);
      await persist();
    }
    if (retainReady) {
      publish({ status: state.canInstall ? 'ready-to-install' : 'available', error: safeError(error), notificationVisible: false });
    } else if (retainAvailable && state.availableVersion) {
      publish({ status: 'available', progress: 0, error: safeError(error), notificationVisible: false });
    } else publish({ status: 'error', error: safeError(error), notificationVisible: false });
  };
  const configureUpdater = () => {
    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
  };
  const withTimeout = (promise, label) => new Promise((resolve, reject) => {
    let settled = false;
    const id = setTimeoutFn(() => {
      if (!settled) { settled = true; reject(new Error(`${label} timed out`)); }
    }, networkTimeoutMs);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true; clearTimeoutFn(id); resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true; clearTimeoutFn(id); reject(error);
    });
  });
  const plainNotes = (value) => {
    if (Array.isArray(value)) return value.map((entry) => typeof entry === 'string' ? entry : entry && entry.note || '').join('\n').slice(0, 20_000);
    return typeof value === 'string' ? value.slice(0, 20_000) : '';
  };
  const scheduleNext = () => {
    if (timer) clearTimeoutFn(timer);
    timer = null;
    if (!started || stopped || !enabled || !state.automaticChecks) return;
    const delay = prefs.retryAt && prefs.retryAt > now() ? prefs.retryAt - now() : DAY;
    timer = setTimeoutFn(() => { timer = null; void checkForUpdates({ automatic: true }); }, delay);
  };
  const bindUpdater = () => {
    if (!updater || typeof updater.on !== 'function') return;
    const listen = (event, handler) => { updater.on(event, handler); updaterHandlers.push([event, handler]); };
    listen('checking-for-update', () => { if (checkPromise && !stopped) publish({ status: 'checking', error: null }); });
    listen('download-progress', (progress) => {
      if (operation !== 'download' || stopped) return;
      publish({ status: 'downloading', progress: Math.max(0, Math.min(100, Number(progress && progress.percent) || 0)) });
    });
    listen('update-downloaded', (info) => {
      if (operation !== 'download' || stopped || !state.availableVersion) return;
      const version = String(info && info.version || '').replace(/^v/i, '');
      if (version !== state.availableVersion || !semver.valid(version) || semver.prerelease(version)) return;
      publish({ status: 'ready-to-install', availableVersion: version, progress: 100, canInstall: enabled && target.canInstall, error: null });
    });
    listen('error', (error) => {
      if (operation === 'install') { void recoverInstall(error); return; }
      if (operation === 'download') {
        if (downloadToken && downloadToken.cancelled) { publish({ status: 'available', progress: 0, error: null }); return; }
        return;
      }
      // Discovery failures are handled by the promise returned from checkForUpdates.
    });
  };
  const fallbackCheck = async (generation) => {
    const releases = await withTimeout(releaseRequest(options.releaseRequestOptions || {}), 'Release check');
    if (stopped || generation !== checkGeneration) return snapshot();
    const apiPlatform = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform === 'linux' ? 'linux' : platform;
    const { release, hasNewerRelease } = findLatestCompatibleRelease(releases, currentVersion, apiPlatform, arch, { appImage: Boolean(env && env.APPIMAGE) });
    const checked = await markChecked();
    const { lastCheckedAt } = checked;
    if (stopped || generation !== checkGeneration) return snapshot();
    if (!release) {
      if (hasNewerRelease) {
        publish({ status: 'error', availableVersion: null, lastCheckedAt, error: 'A newer release exists, but it has no compatible download for this installation', notificationVisible: false });
      } else if (releases.complete === false) {
        publish({ status: 'error', availableVersion: null, lastCheckedAt, error: 'The release history was incomplete, so the app could not confirm whether it is up to date', notificationVisible: false });
      } else {
        publish({ status: 'up-to-date', availableVersion: null, lastCheckedAt, notificationVisible: false, error: checked.error });
      }
      return snapshot();
    }
    publish({ status: 'available', availableVersion: release.version, releaseNotes: plainNotes(release.releaseNotes), lastCheckedAt, notificationVisible: shouldNotify(release.version), canInstall: false, error: checked.error });
    return snapshot();
  };
  async function checkForUpdates({ automatic = false } = {}) {
    await ensureReady();
    if (stopped) return snapshot();
    if (checkPromise) return checkPromise;
    if (operation || ['downloading', 'ready-to-install', 'installing'].includes(state.status)) return snapshot();
    if (!enabled) {
      publish({ status: 'error', error: 'Updates are available only in an installed build', notificationVisible: false });
      return snapshot();
    }
    if (prefs.retryAt && prefs.retryAt > now()) {
      const seconds = Math.ceil((prefs.retryAt - now()) / 1000);
      publish({ status: 'error', error: `The update service asked the app to retry in ${seconds} seconds`, notificationVisible: false });
      if (automatic) scheduleNext();
      return snapshot();
    }
    const generation = ++checkGeneration;
    const run = (async () => {
      publish({ status: 'checking', error: null });
      try {
        if (target.canInstall && updater) {
          const result = await withTimeout(updater.checkForUpdates(), 'Update check');
          if (generation !== checkGeneration || stopped) return snapshot();
          if (!result || !result.updateInfo) {
            if (state.status === 'checking') throw new Error('The update service did not return release metadata');
          } else if (state.status === 'checking') {
            const info = result.updateInfo;
            const version = String(info.version || '').replace(/^v/i, '');
            const checked = await markChecked();
            const { lastCheckedAt } = checked;
            if (generation !== checkGeneration || stopped) return snapshot();
            if (!semver.valid(version)) throw new Error('The update service returned invalid release metadata');
            if (semver.gt(version, currentVersion) && !semver.prerelease(version)) {
              publish({ status: 'available', availableVersion: version, releaseNotes: plainNotes(info.releaseNotes), lastCheckedAt, notificationVisible: shouldNotify(version), error: checked.error });
            } else if (semver.lte(version, currentVersion)) {
              publish({ status: 'up-to-date', availableVersion: null, lastCheckedAt, notificationVisible: false, error: checked.error });
            } else throw new Error('The update service returned a prerelease');
          }
        } else return await fallbackCheck(generation);
        return snapshot();
      } catch (error) {
        if (generation === checkGeneration && !stopped) await fail(error);
        return snapshot();
      } finally {
        if (generation === checkGeneration) checkPromise = null;
        if (!stopped && state.automaticChecks) scheduleNext();
      }
    })();
    checkPromise = run;
    return run;
  }
  async function setAutomaticChecks(value) {
    await ensureReady();
    if (stopped) throw new Error('Update service is stopped');
    if (typeof value !== 'boolean') throw new TypeError('automaticChecks must be a boolean');
    prefs.automaticChecks = value;
    publish({ automaticChecks: value, error: null });
    if (!value) { if (timer) clearTimeoutFn(timer); timer = null; }
    else if (started) scheduleNext();
    const saved = await persist();
    if (!saved) publish({ automaticChecks: value, error: `Could not save update preferences: ${persistenceError}` });
    return snapshot();
  }
  async function downloadUpdate() {
    await ensureReady();
    if (stopped) throw new Error('Update service is stopped');
    if (checkPromise) throw new Error('Wait for the current update check to finish');
    if (!enabled || !target.canInstall || !updater || state.status !== 'available' || !state.availableVersion) throw new Error('In-app updates are not supported for this installation');
    if (operation) throw new Error('Another update operation is in progress');
    operation = 'download'; downloadToken = makeCancellationToken();
    publish({ status: 'downloading', progress: 0, error: null });
    try {
      await updater.downloadUpdate(downloadToken);
      if (operation === 'download' && state.status === 'downloading') {
        publish({ status: 'available', progress: 0, error: 'The updater finished without verifying the downloaded release' });
      }
      return snapshot();
    } catch (error) {
      if (downloadToken && downloadToken.cancelled) publish({ status: 'available', progress: 0, error: null });
      else await fail(error, { retainAvailable: true });
      return snapshot();
    } finally { operation = null; downloadToken = null; }
  }
  let installRecovery = null;
  async function recoverInstall(error) {
    if (installFailureHandled) return installRecovery || snapshot();
    installFailureHandled = true;
    if (installRecovery) return installRecovery;
    installRecovery = (async () => {
      try { await cancelInstall(); } catch (cleanupError) { logger.warn('Unable to release update install lock:', safeError(cleanupError)); }
      operation = null;
      await fail(error, { retainReady: true });
    })();
    return installRecovery;
  }
  async function installUpdate() {
    await ensureReady();
    if (stopped) throw new Error('Update service is stopped');
    if (state.status !== 'ready-to-install' || !state.canInstall || !updater) throw new Error('No installable update is ready');
    if (operation) throw new Error('Another update operation is in progress');
    operation = 'install'; installFailureHandled = false; installRecovery = null;
    publish({ status: 'installing', error: null });
    try {
      await prepareInstall();
      const result = updater.quitAndInstall(false, true);
      if (result && typeof result.then === 'function') await result;
      return snapshot();
    } catch (error) { await recoverInstall(error); throw error; }
  }
  async function dismissUpdate() {
    await ensureReady();
    if (stopped) throw new Error('Update service is stopped');
    const version = state.availableVersion;
    if (version) {
      prefs.dismissedVersions[version] = now();
      const saved = await persist();
      if (!saved) { publish({ error: `Could not save update reminder: ${persistenceError}` }); return snapshot(); }
    }
    publish({ notificationVisible: false });
    return snapshot();
  }
  async function openReleasePage() {
    await ensureReady();
    if (stopped) throw new Error('Update service is stopped');
    if (!shell || typeof shell.openExternal !== 'function') return false;
    await shell.openExternal(RELEASES_URL);
    return true;
  }
  async function cancelDownload() {
    await ensureReady();
    if (stopped) return false;
    if (operation !== 'download' || !downloadToken) return false;
    downloadToken.cancel();
    return true;
  }
  function start() {
    if (readyPromise) return readyPromise;
    if (stopped) return Promise.resolve(snapshot());
    started = true;
    configureUpdater();
    bindUpdater();
    readyPromise = loadPrefs().then(() => {
      if (started && !stopped && enabled && state.automaticChecks) {
        timer = setTimeoutFn(() => { timer = null; void checkForUpdates({ automatic: true }); }, FIRST_CHECK_DELAY);
      }
      return snapshot();
    });
    return readyPromise;
  }
  function stop() {
    stopped = true; started = false; checkGeneration += 1;
    if (timer) clearTimeoutFn(timer);
    timer = null;
    for (const [event, handler] of updaterHandlers.splice(0)) {
      if (updater && typeof updater.removeListener === 'function') updater.removeListener(event, handler);
    }
    return persistenceQueue;
  }
  configureUpdater();
  return Object.assign(emitter, {
    getState: snapshot, start, stop,
    checkForUpdates: () => checkForUpdates({ automatic: false }),
    setAutomaticChecks, downloadUpdate, installUpdate, dismissUpdate, openReleasePage, cancelDownload,
    targetKind: target.kind, architecture: arch,
  });
}

module.exports = { createUpdateService, detectInstallTarget, FIRST_CHECK_DELAY, DAY, NETWORK_TIMEOUT };
