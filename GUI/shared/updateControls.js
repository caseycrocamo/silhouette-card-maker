// Shared renderer-side update state and actions. One IPC subscription is kept per page.
const { ipcRenderer } = require('electron');

const singletonKey = '__silhouetteUpdateControls';
if (!window[singletonKey]) {
    const listeners = new Set();
    let state = null;

    function publish(nextState) {
        if (!nextState || typeof nextState !== 'object') return;
        state = nextState;
        listeners.forEach(listener => listener(state));
    }

    const onState = (_event, nextState) => publish(nextState);
    ipcRenderer.on('updates:state', onState);

    const api = {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            if (state) listener(state);
            return () => listeners.delete(listener);
        },
        async refresh() {
            try { publish(await ipcRenderer.invoke('updates:get-state')); } catch (error) { console.error('Could not load update state', error); }
            return state;
        },
        check: () => ipcRenderer.invoke('updates:check'),
        setAutomatic: enabled => ipcRenderer.invoke('updates:set-automatic', Boolean(enabled)),
        download: () => ipcRenderer.invoke('updates:download'),
        install: () => ipcRenderer.invoke('updates:install'),
        dismiss: () => ipcRenderer.invoke('updates:dismiss'),
        openRelease: () => ipcRenderer.invoke('updates:open-release'),
        cancelDownload: () => ipcRenderer.invoke('updates:cancel-download'),
        dispose() {
            ipcRenderer.removeListener('updates:state', onState);
            listeners.clear();
            delete window[singletonKey];
        }
    };

    window[singletonKey] = api;
    window.addEventListener('beforeunload', api.dispose, { once: true });
}

module.exports = window[singletonKey];
