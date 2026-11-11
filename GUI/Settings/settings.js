(() => {
const { ipcRenderer } = require('electron');
const path = require('path');
const { getOutputDir } = require('../shared/constants');
const updateControls = require(path.join(__dirname, '../shared/updateControls.js'));
const { readPageSize, savePageSize } = require(path.join(__dirname, '../shared/printingPreferences.js'));

function formatLastChecked(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function renderUpdateState(state) {
    if (!state) return;
    const byId = id => document.getElementById(id);
    byId('updateCurrentVersion').textContent = state.currentVersion || 'Unknown';
    byId('updateLastChecked').textContent = formatLastChecked(state.lastCheckedAt);
    byId('automaticUpdateChecks').checked = Boolean(state.automaticChecks);
    byId('automaticUpdateChecks').disabled = state.enabled === false;
    byId('checkUpdatesBtn').disabled = state.enabled === false || ['checking', 'installing'].includes(state.status);
    const labels = {
        idle: state.enabled === false ? 'Update checks are unavailable in development.' : 'Ready to check for updates.',
        checking: 'Checking for updates…',
        'up-to-date': 'You have the latest version.',
        available: state.canInstall
            ? `Version ${state.availableVersion || ''} is available.`
            : `Version ${state.availableVersion || ''} is available. Download it from the release page and install it outside the app. Quit the app before replacing it.`,
        downloading: `Downloading update… ${Math.round(state.progress || 0)}%`,
        'ready-to-install': `Version ${state.availableVersion || ''} is ready to install.`,
        installing: 'Preparing to restart and install…',
        error: state.error || 'The update check failed.'
    };
    byId('updateStatus').textContent = labels[state.status] || 'Update status is unavailable.';
    byId('updateError').hidden = !state.error;
    byId('updateError').textContent = state.error || '';
    byId('updateReleaseNotes').textContent = state.releaseNotes || '';
    const progress = byId('updateProgress');
    progress.value = Number(state.progress) || 0;
    progress.hidden = state.status !== 'downloading';

    const actions = byId('updateActions');
    actions.replaceChildren();
    const addButton = (label, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'paper-button py-2 px-3';
        button.textContent = label;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await handler(); } catch (error) {
                console.error('Update action failed', error);
                byId('updateError').hidden = false;
                byId('updateError').textContent = error.message || String(error);
            }
            finally { button.disabled = false; }
        });
        actions.appendChild(button);
    };
    if (state.status === 'available') {
        addButton(state.canInstall ? 'Download update' : 'Open release page', state.canInstall ? updateControls.download : updateControls.openRelease);
        addButton('Later', updateControls.dismiss);
    }
    if (state.status === 'downloading') addButton('Cancel download', updateControls.cancelDownload);
    if (state.status === 'ready-to-install') {
        addButton('Restart and install', updateControls.install);
        addButton('Later', updateControls.dismiss);
    }
    if (state.status === 'error') addButton('Open release page', updateControls.openRelease);
}

let savedOffsets = { x_offset: 0, y_offset: 0, angle_offset: 0 };
let calibrationPapers = [];

async function loadOffsetData() {
    try {
        const data = await ipcRenderer.invoke('read-offset-data');
        savedOffsets = {
            x_offset: Number(data?.x_offset ?? 0),
            y_offset: Number(data?.y_offset ?? 0),
            angle_offset: Number(data?.angle_offset ?? 0)
        };
        document.getElementById('editXOffset').value = savedOffsets.x_offset;
        document.getElementById('editYOffset').value = savedOffsets.y_offset;
        document.getElementById('editAngleOffset').value = savedOffsets.angle_offset;
    } catch (error) {
        console.error('Could not load printer offsets', error);
    }
}

function validPpi(value) {
    const ppi = Number(value);
    if (!Number.isInteger(ppi) || ppi <= 0) throw new Error('PPI must be a positive whole number.');
    return ppi;
}

function renderCalibrationPapers(papers) {
    calibrationPapers = Array.isArray(papers) ? papers : [];
    const container = document.getElementById('calibrationPaperSizes');
    container.replaceChildren();
    if (!calibrationPapers.length) {
        container.textContent = 'No configured paper sizes are available.';
        return;
    }
    for (const paper of calibrationPapers) {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'calibrationPaperSize';
        checkbox.value = paper.name;
        checkbox.className = 'h-5 w-5';
        label.append(checkbox, document.createTextNode(`${paper.name} (${paper.width} × ${paper.height})`));
        container.appendChild(label);
    }
    document.getElementById('selectAllCalibrationPapers').checked = false;
}

function selectedCalibrationPapers() {
    return Array.from(document.querySelectorAll('input[name="calibrationPaperSize"]:checked'), input => input.value);
}

window.addEventListener('DOMContentLoaded', () => {
    const printingPageSize = document.getElementById('printingPageSize');
    const printingStatus = document.getElementById('printingPreferencesStatus');
    printingPageSize.value = readPageSize();
    document.getElementById('printingPreferencesForm').addEventListener('submit', event => {
        event.preventDefault();
        try {
            printingPageSize.value = savePageSize(printingPageSize.value);
            printingPageSize.setAttribute('aria-invalid', 'false');
            printingStatus.textContent = 'Saved. Applies the next time you open the printing selector.';
        } catch (error) {
            printingPageSize.setAttribute('aria-invalid', 'true');
            printingStatus.textContent = error.message || 'Could not save the printing setting.';
            printingPageSize.focus();
        }
    });
    const unsubscribeUpdates = updateControls.subscribe(renderUpdateState);
    updateControls.refresh();
    document.getElementById('checkUpdatesBtn').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try { await updateControls.check(); } catch (error) {
            console.error('Update check failed', error);
            document.getElementById('updateError').hidden = false;
            document.getElementById('updateError').textContent = error.message || String(error);
        }
        finally { button.disabled = false; }
    });
    document.getElementById('automaticUpdateChecks').addEventListener('change', async event => {
        const checkbox = event.currentTarget;
        const nextValue = checkbox.checked;
        checkbox.disabled = true;
        try { await updateControls.setAutomatic(nextValue); }
        catch (error) {
            console.error('Could not update automatic checks preference', error);
            checkbox.checked = !nextValue;
            document.getElementById('updateError').hidden = false;
            document.getElementById('updateError').textContent = error.message || String(error);
        }
        finally { checkbox.disabled = false; }
    });
    window.addEventListener('beforeunload', unsubscribeUpdates, { once: true });

    loadOffsetData();

    ipcRenderer.invoke('get-calibration-capabilities').then(metadata => {
        renderCalibrationPapers(metadata?.paper_sizes);
    }).catch(error => {
        console.error('Could not load configured paper sizes', error);
        document.getElementById('calibrationPaperSizes').textContent = error.message || 'Could not load paper sizes.';
    });
    document.getElementById('selectAllCalibrationPapers').addEventListener('change', event => {
        document.querySelectorAll('input[name="calibrationPaperSize"]').forEach(input => { input.checked = event.currentTarget.checked; });
    });
    document.getElementById('calibrationPaperSizes').addEventListener('change', () => {
        const checkboxes = Array.from(document.querySelectorAll('input[name="calibrationPaperSize"]'));
        document.getElementById('selectAllCalibrationPapers').checked = checkboxes.length > 0 && checkboxes.every(input => input.checked);
    });

    ipcRenderer.invoke('get-default-calibration-pdf').then(defaultPath => {
        document.getElementById('offsetPdfPath').value = defaultPath;
        document.getElementById('offsetOutputPath').value = path.join(getOutputDir(), `${path.parse(defaultPath).name}_offset.pdf`);
    });

    document.getElementById('saveOffsetBtn').onclick = async function() {
        const x_offset = Number(document.getElementById('editXOffset').value);
        const y_offset = Number(document.getElementById('editYOffset').value);
        const angle_offset = Number(document.getElementById('editAngleOffset').value);
        if (![x_offset, y_offset, angle_offset].every(Number.isFinite) || !Number.isInteger(x_offset) || !Number.isInteger(y_offset)) {
            alert('X and Y offsets must be whole pixels. The angle must be a valid number.');
            return;
        }
        try {
            savedOffsets = await ipcRenderer.invoke('save-offset-data', { x_offset, y_offset, angle_offset });
            alert('Offset data saved.');
            loadOffsetData();
        } catch (err) {
            alert('Error saving offset data:\n' + err);
        }
    };

    document.getElementById('browsePdfBtn').onclick = async function() {
        const filePath = await ipcRenderer.invoke('select-pdf-file');
        if (filePath) {
            document.getElementById('offsetPdfPath').value = filePath;
            const parsed = path.parse(filePath);
            document.getElementById('offsetOutputPath').value = path.join(getOutputDir(), `${parsed.name}_offset.pdf`);
        }
    };

    document.getElementById('browseOffsetOutputBtn').onclick = async function() {
        const filePath = await ipcRenderer.invoke('select-pdf-setting-path', {
            kind: 'pdf', defaultPath: document.getElementById('offsetOutputPath').value || undefined
        });
        if (filePath) document.getElementById('offsetOutputPath').value = filePath.path || filePath;
    };

    document.getElementById('browseCalibrationDirBtn').onclick = async function() {
        const outputDir = await ipcRenderer.invoke('select-pdf-setting-path', {
            kind: 'directory', defaultPath: document.getElementById('calibrationOutputDir').value || undefined
        });
        if (outputDir) document.getElementById('calibrationOutputDir').value = outputDir.path || outputDir;
    };

    document.getElementById('generateCalibrationBtn').onclick = async function() {
        const paperSizes = selectedCalibrationPapers();
        if (!paperSizes.length) { alert('Select at least one paper size.'); return; }
        let ppi;
        try { ppi = validPpi(document.getElementById('calibrationPpi').value); }
        catch (error) { alert(error.message); return; }
        const button = this;
        button.disabled = true;
        const status = document.getElementById('calibrationStatus');
        status.textContent = 'Generating calibration sheets…';
        try {
            const result = await ipcRenderer.invoke('generate-calibration-sheets', {
                paperSizes,
                outputDir: document.getElementById('calibrationOutputDir').value || undefined,
                ppi
            });
            const paths = result?.paths || [];
            status.textContent = `Created ${paths.length} calibration sheet${paths.length === 1 ? '' : 's'}.`;
            if (paths.length === 1) location.href = '../Utilities/pdf_viewer.html?path=' + encodeURIComponent(paths[0]);
            else if (paths.length) status.textContent += ` ${paths.join(', ')}`;
        } catch (error) {
            status.textContent = error.message || String(error);
        } finally { button.disabled = false; }
    };

    document.getElementById('runOffsetPdfBtn').onclick = async function() {
        const pdfPath = document.getElementById('offsetPdfPath').value.trim();
        let outputPdfPath = document.getElementById('offsetOutputPath').value.trim();
        if (!pdfPath) { alert('Choose an input PDF.'); return; }
        if (!outputPdfPath) {
            const parsed = path.parse(pdfPath);
            outputPdfPath = path.join(getOutputDir(), `${parsed.name}_offset.pdf`);
            document.getElementById('offsetOutputPath').value = outputPdfPath;
        }
        let ppi;
        try { ppi = validPpi(document.getElementById('runPpi').value); }
        catch (error) { alert(error.message); return; }
        const readOverride = id => {
            const raw = document.getElementById(id).value;
            if (raw.trim() === '') return undefined;
            const value = Number(raw);
            if (!Number.isFinite(value)) throw new Error('Offset overrides must be valid numbers.');
            if ((id === 'runXOffset' || id === 'runYOffset') && !Number.isInteger(value)) throw new Error('X and Y overrides must be whole pixels.');
            return value;
        };
        let xOffset, yOffset, angle;
        try {
            xOffset = readOverride('runXOffset');
            yOffset = readOverride('runYOffset');
            angle = readOverride('runAngleOffset');
        } catch (error) { alert(error.message); return; }

        window.showLoadingOverlay({
            title: 'Running Offset PDF',
            message: 'Applying printer offsets...'
        });

        try {
            const stdout = await ipcRenderer.invoke('run-offset-pdf', {
                pdfPath, outputPdfPath, xOffset, yOffset, angle, ppi, save: false
            });
            window.hideLoadingOverlay();
            const match = stdout.match(/Offset PDF: (.+)/);
            if (match) {
                location.href = '../Utilities/pdf_viewer.html?path=' + encodeURIComponent(match[1].trim());
            } else {
                alert(stdout);
            }
        } catch (err) {
            window.hideLoadingOverlay();
            alert('Error running offset PDF:\n' + err);
        }
    };
});
})();
