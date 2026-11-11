'use strict';
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', async () => {
    const get = id => document.getElementById(id);
    const editor = get('mdText');
    const status = get('translationStatus');
    let active = false;
    editor.value = sessionStorage.getItem('mtg-md-text') || '';
    const saveDraft = () => sessionStorage.setItem('mtg-md-text', editor.value);
    editor.addEventListener('input', saveDraft);
    const fail = error => { status.textContent = error.message || String(error); };
    get('openMarkdownBtn').onclick = async () => {
        if (active) return;
        try {
            const selected = await ipcRenderer.invoke('open-translation-markdown');
            if (!selected) return;
            editor.value = selected.text;
            get('markdownSource').textContent = selected.path;
            saveDraft();
            status.textContent = 'File opened. Changes in this editor do not change the source file.';
        } catch (error) { fail(error); }
    };
    get('chooseTranslationOutputBtn').onclick = async () => {
        if (active) return;
        try {
            const selected = await ipcRenderer.invoke('select-translation-output', { defaultPath: get('translationOutputPath').value });
            if (selected) get('translationOutputPath').value = selected;
        } catch (error) { fail(error); }
    };
    get('mdForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (active) return;
        const ppi = Number(get('ppi').value), quality = Number(get('quality').value);
        if (!editor.value.trim()) { status.textContent = 'Enter Markdown text or open a file.'; return; }
        if (!get('ppi').value.trim() || !Number.isSafeInteger(ppi) || ppi < 1) { status.textContent = 'PPI must be a positive whole number.'; return; }
        if (!get('quality').value.trim() || !Number.isInteger(quality) || quality < 0 || quality > 100) { status.textContent = 'Quality must be a whole number from 0 to 100.'; return; }
        if (!get('paperSize').value) { status.textContent = 'Choose a configured paper size.'; return; }
        active = true;
        const controls = Array.from(get('mdForm').querySelectorAll('button,input,select,textarea'));
        controls.forEach(control => { control.disabled = true; });
        get('translationResultContainer').hidden = true;
        status.textContent = 'Creating PDF…';
        window.showLoadingOverlay?.({ title: 'Creating PDF', message: 'Preparing printable text cards…' });
        try {
            const result = await ipcRenderer.invoke('run-md-to-pdf', {
                markdownText: editor.value, paperSize: get('paperSize').value, ppi, quality,
                outputPath: get('translationOutputPath').value,
            });
            get('translationOutputPath').value = result.outputPath;
            get('translationResult').href = '../Utilities/pdf_viewer.html?path=' + encodeURIComponent(result.outputPath);
            get('translationResult').textContent = `Open PDF: ${result.outputPath}`;
            get('translationResultContainer').hidden = false;
            status.textContent = `PDF created: ${result.outputPath}`;
        } catch (error) { fail(error); }
        finally {
            active = false;
            controls.forEach(control => { control.disabled = false; });
            window.hideLoadingOverlay?.();
        }
    });
    try {
        const metadata = await ipcRenderer.invoke('get-translation-capabilities');
        get('paperSize').replaceChildren(...metadata.paper_sizes.map(paper => new Option(paper.name, paper.name)));
        get('paperSize').value = metadata.paper_sizes.some(paper => paper.name === 'letter') ? 'letter' : metadata.paper_sizes[0]?.name || '';
        get('translationOutputPath').value = metadata.defaultOutputPath;
        get('generatePdfBtn').disabled = !get('paperSize').value;
    } catch (error) { fail(error); }
});
