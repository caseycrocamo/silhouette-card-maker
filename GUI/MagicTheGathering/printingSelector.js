"use strict";

const { createButton } = require('../shared/button');
const { setCardImage } = require('../shared/cardImages');
const { createLoadingIndicator } = require('../shared/loadingIndicator');
const { readPageSize } = require('../shared/printingPreferences');

let activeSelector = null;

function getPrintingKey(card) {
    return card.id || `${card.set || ''}:${card.collector_number || ''}:${card.lang || ''}`;
}

function safeImageUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && ['cards.scryfall.io', 'api.scryfall.com'].includes(url.hostname)
            ? url.href : null;
    } catch { return null; }
}

function getPrintingImages(card) {
    const image = uris => [uris?.png, uris?.normal, uris?.large, uris?.small].map(safeImageUrl).find(Boolean);
    const front = image(card.image_uris);
    if (front) return [front];
    return (card.card_faces || []).map(face => image(face.image_uris)).filter(Boolean);
}

function hasPrintableImage(card) {
    return Boolean(card && (safeImageUrl(card.image_uris?.png)
        || card.card_faces?.some(face => safeImageUrl(face.image_uris?.png))));
}

function getPrintingTreatment(card) {
    const treatments = [];
    if (card.border_color === 'borderless') treatments.push('Borderless');
    if (card.frame_effects?.includes('showcase')) treatments.push('Showcase');
    if (card.frame_effects?.includes('extendedart')) treatments.push('Extended art');
    if (card.frame === '1993' || card.frame === '1997') treatments.push('Retro frame');
    if (card.full_art && !treatments.includes('Borderless')) treatments.push('Full art');
    return treatments.join(' · ') || 'Regular';
}

function apiUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'api.scryfall.com' || !url.pathname.startsWith('/cards/')) {
        throw new Error('Invalid printing result address.');
    }
    return url.href;
}

function createPrintingPager(card, { signal, fetchImpl = fetch } = {}) {
    let next = card.prints_search_uri ? apiUrl(card.prints_search_uri) : null;
    const seenPages = new Set();
    const printings = new Map();
    if (!next) printings.set(getPrintingKey(card), card);
    let pending = null;
    async function readPage() {
        if (pending) return pending;
        if (!next) return;
        const address = next;
        pending = (async () => {
            if (signal?.aborted) throw new DOMException('Request canceled.', 'AbortError');
            if (seenPages.has(address)) throw new Error('The printing result pages repeat.');
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal?.addEventListener('abort', abort, { once: true });
            const timeout = setTimeout(abort, 20000);
            try {
                const response = await fetchImpl(address, { signal: controller.signal });
                if (!response.ok) throw new Error('Unable to load printings.');
                const page = await response.json();
                if (signal?.aborted) throw new DOMException('Request canceled.', 'AbortError');
                if (!Array.isArray(page.data)) throw new Error('Invalid printing results.');
                if (page.has_more && !page.next_page) throw new Error('A printing result page is missing.');
                const following = page.has_more ? apiUrl(page.next_page) : null;
                if (following && (following === address || seenPages.has(following))) throw new Error('The printing result pages repeat.');
                for (const printing of page.data) {
                    if (printing && typeof printing === 'object' && printing.set && printing.collector_number) {
                        printings.set(getPrintingKey(printing), printing);
                    }
                }
                seenPages.add(address);
                next = following;
            } finally {
                clearTimeout(timeout);
                signal?.removeEventListener('abort', abort);
            }
        })();
        try { await pending; } finally { pending = null; }
    }
    return {
        async load(count, { all = false } = {}) {
            while (next && (all || printings.size < count)) await readPage();
            return { choices: [...printings.values()], hasMore: Boolean(next) };
        },
    };
}

async function fetchPrintings(card, options) {
    return (await createPrintingPager(card, options).load(Infinity)).choices;
}

function closePrintingSelector() {
    activeSelector?.close();
}

function openPrintingSelector({ card, onApply, trigger }) {
    closePrintingSelector();
    const doc = trigger?.ownerDocument || document;
    const controller = new AbortController();
    const previousFocus = trigger || doc.activeElement;
    let closed = false;
    let choices = [];
    const pageSize = readPageSize(doc.defaultView?.localStorage);
    let visibleLimit = pageSize;
    let hasMorePages = false;
    let retryRequest = {};
    const pager = createPrintingPager(card, { signal: controller.signal });
    let candidate = card;
    let faceIndex = 0;
    let loading = true;
    let loadFailed = false;
    let applying = false;
    let loadVersion = 0;
    const make = (tag, className, text) => {
        const element = doc.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const button = options => createButton({ size: 'compact', ...options }, doc);
    const dialog = make('dialog', 'printing-selector');
    dialog.id = 'printingSelectorDialog';
    dialog.setAttribute('aria-labelledby', 'printingSelectorTitle');
    dialog.setAttribute('aria-describedby', 'printingSelectorCard');
    const header = make('header', 'printing-selector__header');
    const heading = make('div');
    const title = make('h2', null, 'Choose a printing');
    title.id = 'printingSelectorTitle';
    const cardName = make('p', null, card.name || 'Card');
    cardName.id = 'printingSelectorCard';
    heading.append(title, cardName);
    const closeButton = button({ id: 'printingClose', text: '×', size: 'icon', ariaLabel: 'Close printing selector', onClick: () => close() });
    header.append(heading, closeButton);

    const filters = make('div', 'printing-selector__filters');
    const searchLabel = make('label', 'printing-selector__field', 'Search printings');
    const search = make('input', 'paper-input');
    search.id = 'printingSearch';
    search.type = 'search';
    search.placeholder = 'Set name, code, or collector number';
    searchLabel.htmlFor = search.id;
    searchLabel.append(search);
    const sortLabel = make('label', 'printing-selector__field', 'Sort by');
    const sort = make('select', 'paper-input');
    sort.id = 'printingSort';
    for (const [value, text] of [['newest', 'Newest first'], ['set', 'Set name']]) {
        const option = make('option', null, text);
        option.value = value;
        sort.append(option);
    }
    sortLabel.htmlFor = sort.id;
    sortLabel.append(sort);
    filters.append(searchLabel, sortLabel);

    const status = make('div', 'printing-selector__status');
    status.id = 'printingStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = button({ id: 'printingRetry', text: 'Retry', onClick: () => load(retryRequest) });
    retry.hidden = true;
    const content = make('div', 'printing-selector__content');
    const list = make('div', 'printing-selector__list');
    list.id = 'printingList';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Available printings');
    const loadMore = make('a', 'printing-selector__more', 'Load more');
    loadMore.id = 'printingLoadMore';
    loadMore.href = '#';
    loadMore.hidden = true;
    loadMore.addEventListener('click', event => {
        event.preventDefault();
        if (!loading && !closed) load({ more: true });
    });
    const preview = make('section', 'printing-selector__preview');
    preview.id = 'printingPreview';
    preview.setAttribute('aria-label', 'Printing preview');
    content.append(list, preview);
    const footer = make('footer', 'printing-selector__footer');
    const note = make('p', null, 'Only this card entry will change.');
    const applyError = make('p', 'printing-selector__apply-error');
    applyError.id = 'printingApplyError';
    applyError.setAttribute('role', 'alert');
    applyError.hidden = true;
    const actions = make('div', 'printing-selector__actions');
    const cancel = button({ id: 'printingCancel', text: 'Cancel', onClick: () => close() });
    const apply = button({ id: 'printingApply', text: 'Use this printing', disabled: true, onClick: async () => {
        if (closed || loading || applying || !hasPrintableImage(candidate) || !choices.some(item => getPrintingKey(item) === getPrintingKey(candidate))) return;
        const chosen = candidate;
        applying = true;
        apply.disabled = true;
        applyError.hidden = true;
        try {
            await onApply(chosen);
            close(false);
            const nextTrigger = previousFocus?.id ? doc.getElementById(previousFocus.id) : previousFocus;
            if (nextTrigger?.isConnected) nextTrigger.focus();
        } catch (error) {
            if (!closed) {
                applyError.textContent = 'Unable to use this printing. Choose another printing or retry.';
                applyError.hidden = false;
                apply.focus();
            }
        } finally {
            applying = false;
            if (!closed) apply.disabled = loading || !hasPrintableImage(candidate);
        }
    } });
    actions.append(cancel, apply);
    const footerText = make('div');
    footerText.append(note, applyError);
    footer.append(footerText, actions);
    dialog.append(header, filters, status, retry, content, footer);
    doc.body.append(dialog);

    function close(restoreFocus = true) {
        if (closed) return;
        closed = true;
        controller.abort();
        if (dialog.open) dialog.close();
        dialog.remove();
        if (activeSelector?.dialog === dialog) activeSelector = null;
        if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    }

    function imageBox(printing, index = 0) {
        const box = make('div', 'printing-image');
        const source = getPrintingImages(printing)[index];
        const state = make('span', 'printing-image__state', source ? 'Loading image…' : 'No image available');
        box.append(state);
        if (!source) return box;
        const image = make('img');
        image.addEventListener('imageloadstart', () => {
            image.hidden = true;
            state.hidden = false;
            state.replaceChildren(createLoadingIndicator(doc));
        });
        image.alt = `${printing.name || card.name} — ${(printing.set || '').toUpperCase()} #${printing.collector_number || ''}${index ? ', back' : ', front'}`;
        image.decoding = 'async';
        image.addEventListener('load', () => { state.hidden = true; image.hidden = false; });
        image.addEventListener('error', () => {
            if (closed) return;
            image.hidden = true;
            state.hidden = false;
            state.replaceChildren(make('span', null, 'Image unavailable'));
            state.append(button({ text: 'Retry image', onClick: event => {
                event.preventDefault();
                event.stopPropagation();
                state.textContent = 'Loading image…';
                setCardImage(image, source);
            } }));
        });
        setCardImage(image, source);
        box.prepend(image);
        return box;
    }

    function metadata(printing) {
        const details = make('div', 'printing-meta');
        details.append(make('strong', null, printing.set_name || (printing.set || '').toUpperCase()));
        details.append(make('span', null, `${(printing.set || '').toUpperCase()} · #${printing.collector_number || ''}`));
        details.append(make('span', null, getPrintingTreatment(printing)));
        return details;
    }

    function renderPreview() {
        preview.replaceChildren();
        apply.disabled = loading || applying || !hasPrintableImage(candidate);
        if (!candidate) return;
        preview.append(make('h3', null, 'Preview'), imageBox(candidate, faceIndex), metadata(candidate));
        if (!hasPrintableImage(candidate)) {
            preview.append(make('p', 'printing-selector__unavailable', 'No printable image is available. Choose another printing.'));
        }
        if (getPrintingImages(candidate).length > 1) {
            const faceControls = make('div', 'printing-selector__actions');
            for (const [index, text] of [[0, 'Front'], [1, 'Back']]) {
                const control = button({ id: index ? 'printingBack' : 'printingFront', text, onClick: () => {
                    faceIndex = index;
                    renderPreview();
                    doc.getElementById(index ? 'printingBack' : 'printingFront')?.focus();
                } });
                control.setAttribute('aria-pressed', String(faceIndex === index));
                faceControls.append(control);
            }
            preview.append(faceControls);
        }
        const current = make('p', 'printing-selector__current', `Current: ${(card.set || '').toUpperCase()} · #${card.collector_number || ''}`);
        preview.append(current);
    }

    function renderList() {
        const query = search.value.trim().toLowerCase();
        const filtered = choices.filter(printing => `${printing.set_name || ''} ${printing.set || ''} ${printing.collector_number || ''}`.toLowerCase().includes(query));
        filtered.sort((a, b) => sort.value === 'set'
            ? String(a.set_name || a.set).localeCompare(String(b.set_name || b.set)) || String(a.collector_number).localeCompare(String(b.collector_number), undefined, { numeric: true })
            : String(b.released_at || '').localeCompare(String(a.released_at || '')) || String(a.collector_number).localeCompare(String(b.collector_number), undefined, { numeric: true }));
        list.replaceChildren();
        const visible = filtered.slice(0, visibleLimit);
        for (const printing of visible) {
            const selected = getPrintingKey(printing) === getPrintingKey(candidate);
            const row = make('label', 'printing-option');
            row.dataset.printingId = getPrintingKey(printing);
            const radio = make('input');
            radio.type = 'radio';
            radio.name = 'printingChoice';
            radio.value = getPrintingKey(printing);
            radio.checked = selected;
            radio.setAttribute('aria-label', `${printing.set_name || printing.set}, ${printing.collector_number}, ${getPrintingTreatment(printing)}`);
            const check = make('span', 'printing-option__check', selected ? '✓' : '');
            check.setAttribute('aria-hidden', 'true');
            radio.addEventListener('change', () => {
                candidate = printing;
                faceIndex = 0;
                applyError.hidden = true;
                for (const item of list.querySelectorAll('.printing-option')) {
                    const isSelected = item.dataset.printingId === getPrintingKey(printing);
                    item.querySelector('.printing-option__check').textContent = isSelected ? '✓' : '';
                }
                renderPreview();
            });
            row.append(radio, check, imageBox(printing), metadata(printing));
            list.append(row);
        }
        if (!filtered.length && !loading && !loadFailed) list.append(make('p', 'printing-selector__empty', choices.length ? 'No printings match your search.' : 'No printings are available.'));
        loadMore.hidden = loading || loadFailed || (visible.length >= filtered.length && !hasMorePages);
        list.append(loadMore);
        if (!loading && !loadFailed) status.textContent = `${visible.length} of ${filtered.length}${hasMorePages ? '+' : ''} printings`;
    }

    async function load({ more = false, all = false } = {}) {
        retryRequest = { more, all };
        const target = more ? visibleLimit + pageSize : pageSize;
        const scrollTop = list.scrollTop;
        const version = ++loadVersion;
        loading = true;
        loadFailed = false;
        apply.disabled = true;
        retry.hidden = true;
        status.textContent = more ? 'Loading more printings…' : 'Loading printings…';
        loadMore.hidden = true;
        list.setAttribute('aria-busy', 'true');
        try {
            const result = await pager.load(target, { all });
            if (closed || version !== loadVersion) return;
            choices = result.choices;
            hasMorePages = result.hasMore;
            visibleLimit = target;
            candidate = choices.find(item => getPrintingKey(item) === getPrintingKey(candidate || card)) || choices[0] || null;
            loading = false;
            renderList();
            list.scrollTop = more ? scrollTop : 0;
            if (more) list.querySelectorAll('.printing-option input')[target - pageSize]?.focus({ preventScroll: true });
            renderPreview();
        } catch (error) {
            if (closed || version !== loadVersion) return;
            loading = false;
            loadFailed = true;
            status.textContent = 'Unable to load printings. Check your connection and retry.';
            apply.disabled = !hasPrintableImage(candidate) || !choices.some(item => getPrintingKey(item) === getPrintingKey(candidate));
            retry.hidden = false;
        } finally {
            if (!closed && version === loadVersion) list.setAttribute('aria-busy', 'false');
        }
    }

    const updateFilter = () => {
        if (loadFailed) { renderList(); return; }
        load({ all: true });
    };
    search.addEventListener('input', updateFilter);
    sort.addEventListener('change', updateFilter);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => close());
    activeSelector = { dialog, close };
    dialog.showModal();
    search.focus();
    renderPreview();
    load();
    return close;
}

module.exports = { openPrintingSelector, closePrintingSelector, fetchPrintings, createPrintingPager, getPrintingKey, getPrintingImages, getPrintingTreatment, hasPrintableImage };
