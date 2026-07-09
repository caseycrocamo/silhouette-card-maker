const { shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { getOutputDir } = require('../shared/constants');

function getSelectedPdfFileName() {
    const params = new URLSearchParams(window.location.search);
    const requestedFile = params.get('file');
    if (!requestedFile) {
        return 'game.pdf';
    }

    const cleaned = path.basename(requestedFile);
    if (!cleaned.toLowerCase().endsWith('.pdf')) {
        return 'game.pdf';
    }

    return cleaned;
}

function resolvePdfPath() {
    const params = new URLSearchParams(window.location.search);
    const requestedPath = params.get('path');
    if (requestedPath && requestedPath.toLowerCase().endsWith('.pdf')) {
        return requestedPath;
    }

    return path.join(getOutputDir(), getSelectedPdfFileName());
}

function openInFileExplorer() {
    shell.showItemInFolder(resolvePdfPath());
}

function setPdfSource() {
    const viewerFrame = document.getElementById('pdfFrame');
    if (!viewerFrame) {
        return;
    }

    viewerFrame.src = pathToFileURL(resolvePdfPath()).href;
}

window.addEventListener('DOMContentLoaded', setPdfSource);
