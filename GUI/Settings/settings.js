const { ipcRenderer } = require('electron');

function loadOffsetData() {
    ipcRenderer.invoke('read-offset-data').then(data => {
        document.getElementById('editXOffset').value = data.x_offset;
        document.getElementById('editYOffset').value = data.y_offset;
    });
}

window.addEventListener('DOMContentLoaded', () => {
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
