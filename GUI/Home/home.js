const { ipcRenderer, shell } = require('electron');

window.addEventListener('DOMContentLoaded', async () => {
    const exists = await ipcRenderer.invoke('offset-data-exists');
    if (!exists) {
        document.getElementById('calibrationNotice').classList.remove('hidden');
    }

    document.getElementById('calibrationDocsLink').onclick = (e) => {
        e.preventDefault();
        shell.openExternal('https://alan-cha.github.io/silhouette-card-maker/docs/offset/');
    };
});
