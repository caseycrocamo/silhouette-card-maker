(() => {
const { ipcRenderer } = require('electron');
const path = require('path');
const updateControls = require(path.join(__dirname, '../shared/updateControls.js'));

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

function loadOffsetData() {
    ipcRenderer.invoke('read-offset-data').then(data => {
        document.getElementById('editXOffset').value = data.x_offset;
        document.getElementById('editYOffset').value = data.y_offset;
    });
}

window.addEventListener('DOMContentLoaded', () => {
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

    ipcRenderer.invoke('get-default-calibration-pdf').then(defaultPath => {
        document.getElementById('offsetPdfPath').value = defaultPath;
    });

    document.getElementById('saveOffsetBtn').onclick = async function() {
        const x_offset = document.getElementById('editXOffset').value;
        const y_offset = document.getElementById('editYOffset').value;
        try {
            await ipcRenderer.invoke('save-offset-data', { x_offset, y_offset });
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
        }
    };

    document.getElementById('runOffsetPdfBtn').onclick = async function() {
        const pdfPath = document.getElementById('offsetPdfPath').value.trim();

        window.showLoadingOverlay({
            title: 'Running Offset PDF',
            message: 'Applying printer offsets...'
        });

        try {
            const stdout = await ipcRenderer.invoke('run-offset-pdf', { pdfPath });
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
