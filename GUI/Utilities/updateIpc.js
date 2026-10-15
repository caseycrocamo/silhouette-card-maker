const path = require('node:path');
const { fileURLToPath } = require('node:url');

function isTrustedUpdateSender(event, guiRoot) {
  try {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed()) return false;
    const url = new URL(event.senderFrame.url);
    if (url.protocol !== 'file:') return false;
    const relative = path.relative(guiRoot, fileURLToPath(url));
    return !!relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative) && relative.endsWith('.html');
  } catch {
    return false;
  }
}

function registerUpdateIpc({ ipcMain, BrowserWindow, service, guiRoot = path.resolve(__dirname, '..') }) {
  const commands = {
    'updates:get-state': () => service.getState(),
    'updates:check': () => service.checkForUpdates(),
    'updates:set-automatic': value => {
      if (typeof value !== 'boolean') throw new Error('Automatic checks must be true or false.');
      return service.setAutomaticChecks(value);
    },
    'updates:download': () => service.downloadUpdate(),
    'updates:install': () => service.installUpdate(),
    'updates:dismiss': () => service.dismissUpdate(),
    'updates:open-release': () => service.openReleasePage(),
    'updates:cancel-download': () => service.cancelDownload()
  };
  for (const [channel, command] of Object.entries(commands)) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedUpdateSender(event, guiRoot) || !BrowserWindow.fromWebContents(event.sender)) {
        throw new Error('Update commands are only available to application pages.');
      }
      const expectedArgs = channel === 'updates:set-automatic' ? 1 : 0;
      if (args.length !== expectedArgs) throw new Error('Invalid update command arguments.');
      return command(...args);
    });
  }
  const broadcast = state => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('updates:state', state);
      }
    }
  };
  service.on('state-changed', broadcast);
  return () => {
    service.removeListener('state-changed', broadcast);
    Object.keys(commands).forEach(channel => ipcMain.removeHandler(channel));
  };
}

module.exports = { isTrustedUpdateSender, registerUpdateIpc };
