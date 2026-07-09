const { ipcRenderer } = require('electron');
const { getFrontDir, getBackDir } = require('../shared/constants');

let hoverPreviewEl = null;
let hoverPreviewTimeout = null;

function getHoverPreviewEl() {
    if (!hoverPreviewEl) {
        hoverPreviewEl = document.createElement('img');
        hoverPreviewEl.style.position = 'fixed';
        hoverPreviewEl.style.display = 'none';
        hoverPreviewEl.style.zIndex = '1000';
        hoverPreviewEl.style.pointerEvents = 'none';
        hoverPreviewEl.style.maxWidth = '400px';
        hoverPreviewEl.style.maxHeight = '560px';
        hoverPreviewEl.style.objectFit = 'contain';
        hoverPreviewEl.style.borderRadius = '10px';
        hoverPreviewEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
        hoverPreviewEl.style.border = '2px solid white';
        document.body.appendChild(hoverPreviewEl);
        window.addEventListener('scroll', hideHoverPreview, true);
    }
    return hoverPreviewEl;
}

function hideHoverPreview() {
    clearTimeout(hoverPreviewTimeout);
    if (hoverPreviewEl) {
        hoverPreviewEl.style.display = 'none';
    }
}

function attachHoverPreview(img) {
    let lastX = 0;
    let lastY = 0;

    const positionPreview = (preview) => {
        const offset = 20;
        const maxWidth = 400;
        const maxHeight = 560;
        let left = lastX + offset;
        let top = lastY + offset;
        if (left + maxWidth > window.innerWidth) {
            left = lastX - maxWidth - offset;
        }
        if (top + maxHeight > window.innerHeight) {
            top = window.innerHeight - maxHeight - offset;
        }
        preview.style.left = `${Math.max(0, left)}px`;
        preview.style.top = `${Math.max(0, top)}px`;
    };

    img.addEventListener('mousemove', (e) => {
        lastX = e.clientX;
        lastY = e.clientY;
    });

    img.addEventListener('mouseenter', (e) => {
        lastX = e.clientX;
        lastY = e.clientY;
        clearTimeout(hoverPreviewTimeout);
        hoverPreviewTimeout = setTimeout(() => {
            const preview = getHoverPreviewEl();
            preview.src = img.src;
            positionPreview(preview);
            preview.style.display = 'block';
        }, 1000);
    });

    img.addEventListener('mouseleave', hideHoverPreview);
}

function loadImages() {
    ipcRenderer.invoke('get-front-images').then(files => {
        const grid = document.getElementById('frontImagesGrid');
        grid.innerHTML = '';
        files.forEach(f => {
            const div = document.createElement('div');
            div.style.textAlign = 'center';
            div.style.wordBreak = 'break-all';
            const img = document.createElement('img');
            img.src = `${getFrontDir()}/${f}`;
            img.alt = f;
            img.style.width = '100px';
            img.style.height = '140px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '6px';
            img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
            attachHoverPreview(img);
            div.appendChild(img);
            const label = document.createElement('div');
            label.textContent = f;
            label.style.fontSize = '0.8em';
            label.style.marginTop = '0.5em';
            div.appendChild(label);
            grid.appendChild(div);
        });
    });
}

function loadBackImage() {
    ipcRenderer.invoke('get-back-images').then(files => {
        const preview = document.getElementById('backImagePreview');
        preview.innerHTML = '';
        if (files && files.length > 0) {
            const f = files[0];
            const img = document.createElement('img');
            img.src = `${getBackDir()}/${f}`;
            img.alt = f;
            img.style.width = '150px';
            img.style.height = '210px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '6px';
            img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
            attachHoverPreview(img);
            preview.appendChild(img);
            const label = document.createElement('span');
            label.textContent = f;
            label.style.fontSize = '0.85em';
            label.style.wordBreak = 'break-all';
            preview.appendChild(label);
        } else {
            const placeholder = document.createElement('span');
            placeholder.textContent = 'No back image selected';
            placeholder.style.color = '#999';
            placeholder.style.fontSize = '0.85em';
            preview.appendChild(placeholder);
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    const skip4Checkbox = document.getElementById('skip4Checkbox');

    skip4Checkbox.addEventListener('change', function() {
        let args = pdfArgsInput.value.trim();
        const flag = '--skip 4';
        if (this.checked) {
            if (!args.includes(flag)) {
                args = args.length ? args + ' ' + flag : flag;
            }
        } else {
            // Remove the flag if present
            args = args.replace(/\s*--skip 4\b/, '');
        }
        pdfArgsInput.value = args.trim();
    });
    const pdfArgsInput = document.getElementById('pdfArgs');
    const loadOffsetCheckbox = document.getElementById('loadOffsetCheckbox');

    loadOffsetCheckbox.addEventListener('change', function() {
        let args = pdfArgsInput.value.trim();
        const flag = '--load_offset';
        if (this.checked) {
            if (!args.includes(flag)) {
                args = args.length ? args + ' ' + flag : flag;
            }
        } else {
            // Remove the flag if present
            args = args.replace(/\s*--load_offset\b/, '');
        }
        pdfArgsInput.value = args.trim();
    });
    const onlyFrontsCheckbox = document.getElementById('onlyFrontsCheckbox');

    onlyFrontsCheckbox.addEventListener('change', function() {
        let args = pdfArgsInput.value.trim();
        const flag = '--only_fronts';
        if (this.checked) {
            if (!args.includes(flag)) {
                args = args.length ? args + ' ' + flag : flag;
            }
        } else {
            // Remove the flag if present
            args = args.replace(/\s*--only_fronts\b/, '');
        }
        pdfArgsInput.value = args.trim();
    });
    loadImages();
    loadBackImage();
    // Listen for event-driven updates from main process
    ipcRenderer.on('front-images-changed', () => {
        loadImages();
    });
    document.getElementById('createPdfBtn').onclick = async function() {
        const args = document.getElementById('pdfArgs').value;
        window.showLoadingOverlay({
            title: 'Creating PDF',
            message: 'Processing card images...'
        });
        
        try {
            const result = await ipcRenderer.invoke('run-create-pdf', args);
            window.hideLoadingOverlay();
            location.href = '../Utilities/pdf_viewer.html';
        } catch (err) {
            window.hideLoadingOverlay();
            alert('Error creating PDF:\n' + err);
        }
    }
    document.getElementById('clearFrontBtn').onclick = async function() {
        try {
            const result = await ipcRenderer.invoke('clear-front-images');
            alert(result);
            loadImages();
        } catch (err) {
            alert('Error clearing images:\n' + err);
        }
    }
    document.getElementById('uploadBackBtn').onclick = async function() {
        try {
            const result = await ipcRenderer.invoke('select-back-image');
            if (result) {
                loadBackImage();
            }
        } catch (err) {
            alert('Error uploading back image:\n' + err);
        }
    }
    document.getElementById('clearBackBtn').onclick = async function() {
        try {
            const result = await ipcRenderer.invoke('clear-back-image');
            alert(result);
            loadBackImage();
        } catch (err) {
            alert('Error clearing back image:\n' + err);
        }
    }
});