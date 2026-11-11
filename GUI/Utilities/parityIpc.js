'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Keep feature dialogs and interactive process events outside the PDF request queue.
function registerParityIpc({ ipcMain, app, dialog, trustedFeatureSender, jobActivity,
  getPdfCapabilities, getOutputDir, getLayoutEnvironment }) {
  let translation;
  const translationService = () => translation ||= require('./translationService').createTranslationService({
    app, getOutputDir, getLayoutEnvironment,
  });
  ipcMain.handle('run-md-to-pdf', (event, options = {}) => {
    trustedFeatureSender(event);
    return jobActivity.run(() => translationService().run(options));
  });
  ipcMain.handle('get-translation-capabilities', event => {
    trustedFeatureSender(event);
    return jobActivity.run(async () => {
      const response = await getPdfCapabilities();
      if (!response.ok) throw new Error(response.error || 'Cannot load paper sizes.');
      return { ...response.result, defaultOutputPath: path.join(getOutputDir(), 'translatedTextBoxes.pdf') };
    });
  });
  ipcMain.handle('open-translation-markdown', async event => {
    trustedFeatureSender(event);
    const result = await dialog.showOpenDialog({ properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] });
    if (result.canceled || !result.filePaths?.length) return null;
    const selected = result.filePaths[0];
    const handle = await fs.promises.open(selected, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Choose a Markdown file smaller than 2 MB.');
      const text = await handle.readFile('utf8');
      if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new Error('Markdown file is too large.');
      return { path: selected, text };
    } finally { await handle.close(); }
  });
  ipcMain.handle('select-translation-output', async (event, options = {}) => {
    trustedFeatureSender(event);
    const result = await dialog.showSaveDialog({ defaultPath: options.defaultPath || path.join(getOutputDir(), 'translatedTextBoxes.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    return result.canceled ? null : result.filePath;
  });
  let studioOwner = null;
  const studio = () => require('./studioClient');
  ipcMain.handle('studio-capabilities', event => { trustedFeatureSender(event); return studio().getCapabilities(); });
  ipcMain.handle('studio-start', async (event, request) => {
    trustedFeatureSender(event);
    if (studioOwner) throw new Error('A Studio job is already running.');
    studioOwner = event.sender;
    const cancel = () => { studio().stopStudioJob(); };
    event.sender.once('destroyed', cancel);
    event.sender.on('did-start-navigation', cancel);
    try {
      return await jobActivity.run(() => studio().startStudioJob(request, update => {
        if (!event.sender.isDestroyed()) event.sender.send('studio-event', update);
      }));
    } finally {
      studioOwner = null;
      event.sender.removeListener('destroyed', cancel);
      event.sender.removeListener('did-start-navigation', cancel);
    }
  });
  for (const [channel, method] of [['studio-reply', 'replyStudioPrompt'], ['studio-stop', 'stopStudioJob']]) {
    ipcMain.handle(channel, (event, request) => {
      trustedFeatureSender(event);
      if (studioOwner && studioOwner !== event.sender) throw new Error('This Studio job belongs to another window.');
      return studio()[method](request);
    });
  }
  ipcMain.handle('studio-select-path', async (event, { kind, defaultPath } = {}) => {
    trustedFeatureSender(event);
    if (kind === 'studio3' || kind === 'calibration') {
      const result = await dialog.showSaveDialog({ defaultPath, filters: [kind === 'studio3'
        ? { name: 'Silhouette Studio', extensions: ['studio3'] } : { name: 'Calibration', extensions: ['json'] }] });
      return result.canceled ? null : result.filePath;
    }
    if (!['dxf', 'directory', 'executable', 'calibration-input'].includes(kind)) throw new Error('Invalid Studio path kind.');
    const result = await dialog.showOpenDialog({ defaultPath,
      properties: [kind === 'directory' ? 'openDirectory' : 'openFile'],
      ...(kind === 'directory' ? {} : { filters: [kind === 'dxf'
        ? { name: 'DXF', extensions: ['dxf'] } : kind === 'calibration-input'
          ? { name: 'Calibration', extensions: ['json'] } : { name: 'Windows executable', extensions: ['exe'] }] }),
    });
    return result.canceled ? null : result.filePaths?.[0] || null;
  });
}
module.exports = { registerParityIpc };
