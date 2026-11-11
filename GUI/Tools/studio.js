'use strict';
(() => {
  const { ipcRenderer, shell } = require('electron');
  const { createButton } = require('../shared/button');
  const $ = id => document.getElementById(id);
  let active = false, supported = false, pendingPrompt = null;
  function updateControls() {
    const operation = $('studioOperation').value;
    document.querySelectorAll('[data-studio-single]').forEach(node => { node.hidden = operation !== 'single'; });
    document.querySelectorAll('[data-studio-batch]').forEach(node => { node.hidden = operation !== 'batch'; });
    document.querySelectorAll('[data-studio-convert]').forEach(node => { node.hidden = operation === 'calibrate'; });
    $('studioForm').querySelectorAll('input,select,button').forEach(control => {
      control.disabled = !supported || active;
    });
    const calibrationPicker = document.querySelector('[data-studio-pick=calibration]');
    if (calibrationPicker) calibrationPicker.textContent = operation === 'calibrate' ? 'Choose calibration destination' : 'Open saved calibration';
    $('studioStop').disabled = !active;
    $('studioStart').textContent = operation === 'calibrate' ? 'Start automation calibration' : $('studioDryRun').checked ? 'Preview conversion' : 'Start Studio automation';
  }
  function request() {
    const payload = { operation: $('studioOperation').value,
      unit: $('studioUnit').value, orientation: $('studioOrientation').value,
      paperSize: $('studioPaper').value, actionDelay: Number($('studioDelay').value),
      dryRun: $('studioOperation').value !== 'calibrate' && $('studioDryRun').checked, missingOnly: $('studioMissing').checked,
      center: $('studioCenter').checked, registration: $('studioRegistration').checked,
      regLength: Number($('studioRegLength').value), regThickness: Number($('studioRegThickness').value),
      regInset: Number($('studioRegInset').value) };
    for (const [field, id] of Object.entries({ inputPath: 'studioInput', outputPath: 'studioOutput',
      templateDir: 'studioTemplates', calibrationPath: 'studioCalibration', studioPath: 'studioExecutable' })) {
      if ($(id).value.trim()) payload[field] = $(id).value.trim();
    }
    return payload;
  }
  function clearPrompt() { pendingPrompt = null; $('studioPrompt').hidden = true; $('studioPrompt').replaceChildren(); }
  function showPrompt(event) {
    clearPrompt(); pendingPrompt = event.promptId;
    const host = $('studioPrompt'); host.hidden = false;
    const message = document.createElement('p'); message.textContent = event.message; host.append(message);
    let input;
    if (event.kind === 'version') {
      const label = document.createElement('label'); label.textContent = 'Studio version';
      input = document.createElement('input'); input.className = 'paper-input'; input.value = event.default || 'unknown';
      label.append(input); host.append(label);
    } else {
      const help = document.createElement('p'); help.textContent = 'Select Record, then move the pointer to the Studio control within three seconds. Keep the pointer there until the next step appears. Skip keeps any saved position.'; host.append(help);
    }
    const actions = document.createElement('div'); actions.className = 'studio-prompt-actions';
    for (const [value, label] of event.kind === 'version' ? [['continue', 'Continue']] : [['record', 'Record after 3 seconds'], ['skip', 'Skip'], ['back', 'Back']]) {
      actions.append(createButton({ text: label, onClick: async () => {
        if (!pendingPrompt) return;
        const promptId = pendingPrompt;
        actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try { await ipcRenderer.invoke('studio-reply', { promptId, value: input ? input.value : value }); if (pendingPrompt === promptId) clearPrompt(); }
        catch (error) { $('studioStatus').textContent = error.message || String(error); actions.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
      } }));
    }
    host.append(actions);
    (input || actions.querySelector('button'))?.focus();
  }
  function eventReceived(_event, event) {
    if (!active) return;
    if (event.event === 'prompt') showPrompt(event);
    if (event.event === 'countdown') $('studioStatus').textContent = event.message;
    if (event.event === 'progress') {
      $('studioProgress').max = event.total || 1; $('studioProgress').value = event.completed || 0;
      $('studioStatus').textContent = `${event.completed || 0} of ${event.total || 0}${event.currentFile ? ' · ' + event.currentFile : ''}`;
    }
    if (event.event === 'preview' || event.event === 'output') {
      const row = document.createElement('article'); row.className = 'template-result';
      const text = document.createElement('p'); text.textContent = `${event.inputPath} → ${event.outputPath} · ${event.paperWidth} × ${event.paperHeight} · ${event.orientation}${event.error ? ' · Error: ' + event.error : event.skipped ? ' · Skipped: ' + event.reason : ''}`;
      row.append(text);
      if (event.event === 'output' && !event.skipped && !event.error) row.append(createButton({ text: 'Show output file', size: 'compact', onClick: () => shell.showItemInFolder(event.outputPath) }));
      $('studioResults').append(row);
    }
  }
  window.addEventListener('DOMContentLoaded', async () => {
    if (!$('studioForm')) return;
    updateControls();
    $('studioOperation').onchange = updateControls;
    $('studioDryRun').onchange = updateControls;
    document.querySelectorAll('[data-studio-pick]').forEach(button => { button.onclick = async () => {
      try {
        const value = await ipcRenderer.invoke('studio-select-path', { kind: button.dataset.studioPick === 'calibration' && $('studioOperation').value !== 'calibrate' ? 'calibration-input' : button.dataset.studioPick,
          defaultPath: $(button.dataset.studioTarget).value || undefined });
        if (value) $(button.dataset.studioTarget).value = value;
      } catch (error) { $('studioStatus').textContent = error.message || String(error); }
    }; });
    $('studioStop').onclick = async () => {
      $('studioStop').disabled = true; $('studioStatus').textContent = 'Stopping automation…'; clearPrompt();
      try { await ipcRenderer.invoke('studio-stop'); }
      catch (error) { $('studioStatus').textContent = error.message || String(error); }
    };
    $('studioForm').onsubmit = async event => {
      event.preventDefault(); if (!supported || active) return;
      active = true; updateControls(); clearPrompt(); $('studioResults').replaceChildren();
      $('studioProgress').classList.remove('hidden'); $('studioProgress').value = 0;
      $('studioStatus').textContent = 'Starting Studio job…';
      ipcRenderer.on('studio-event', eventReceived);
      try {
        const result = await ipcRenderer.invoke('studio-start', request());
        $('studioStatus').textContent = result.canceled ? result.message || 'Automation stopped. Inspect the current Studio document.' :
          result.dryRun ? 'Preview complete. No automation ran.' : result.calibrationPath ? `Automation calibration saved to ${result.calibrationPath}` : `Converted ${result.completed || 0} files${result.errors ? ' · ' + result.errors + ' errors' : ''}.`;
      } catch (error) { $('studioStatus').textContent = error.message || String(error); }
      finally { active = false; ipcRenderer.removeListener('studio-event', eventReceived); clearPrompt(); updateControls(); $('studioProgress').classList.add('hidden'); }
    };
    try {
      const capability = await ipcRenderer.invoke('studio-capabilities');
      supported = capability?.supported === true;
      $('studioCapability').textContent = supported ? 'Studio automation is available on Windows.' : capability?.message || 'Studio automation requires Windows. Open the DXF in Studio and save it as .studio3.';
      if (capability?.defaultStudioPath) $('studioExecutable').value = capability.defaultStudioPath;
    } catch (_) { $('studioCapability').textContent = 'Studio automation is unavailable. Open the DXF in Silhouette Studio and save it as .studio3.'; }
    updateControls();
    if (supported) {
      try {
        const catalog = await ipcRenderer.invoke('template-request', { command: 'list' });
        $('studioPaper').replaceChildren(...catalog.paper_sizes.map(paper => new Option(paper.name, paper.name)));
        if (catalog.paper_sizes.some(paper => paper.name === 'letter')) $('studioPaper').value = 'letter';
        $('studioTemplates').value = catalog.output_dir || '';
      } catch (_) { /* Conversion validates the selected paper with the runtime catalog. */ }
    }
  });
  window.addEventListener('beforeunload', () => { if (active) ipcRenderer.invoke('studio-stop').catch(() => {}); });
})();
