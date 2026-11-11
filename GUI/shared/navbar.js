(() => {
const path = require('path');
const updateControls = require(path.join(__dirname, '../shared/updateControls.js'));
const { createButton } = require(path.join(__dirname, '../shared/button.js'));

class Navbar extends HTMLElement {
    constructor() {
        super();
    }

    static get observedAttributes() {
        return ['current-step'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'current-step') {
            this.updateContent();
        }
    }

    connectedCallback() {
        this._onPopstate = () => {
            this.updateActiveState();
            this.updateContent();
        };
        this._onResize = () => {
            this.syncUtilityMenu();
            this.measureHeight();
        };
        this._onMenuKeydown = event => {
            if (!this._menuOpen) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                this.setMenuOpen(false, true);
            } else if (event.key === 'Tab') {
                const controls = [this._menuToggle, ...this.querySelectorAll('.navbar-utilities a')];
                const index = controls.indexOf(document.activeElement);
                if (event.shiftKey && index <= 0) {
                    event.preventDefault();
                    controls.at(-1).focus();
                } else if (!event.shiftKey && (index === controls.length - 1 || index < 0)) {
                    event.preventDefault();
                    controls[0].focus();
                }
            }
        };
        this._onOutsidePointer = event => {
            if (this._menuOpen && !this._menuToggle.contains(event.target) && !this.querySelector('.navbar-utilities').contains(event.target)) {
                event.preventDefault();
                this.setMenuOpen(false, true);
            }
        };
        document.addEventListener('keydown', this._onMenuKeydown);
        document.addEventListener('pointerdown', this._onOutsidePointer);
        window.addEventListener('popstate', this._onPopstate);
        window.addEventListener('resize', this._onResize);
        this.updateActiveState();
        this.updateContent();
        this.initializeUpdateBanner();
    }

    disconnectedCallback() {
        this.restoreMenuBackground();
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        document.removeEventListener('keydown', this._onMenuKeydown);
        document.removeEventListener('pointerdown', this._onOutsidePointer);
        this._menuToggle = null;
        this._menuOpen = false;
        window.removeEventListener('popstate', this._onPopstate);
        window.removeEventListener('resize', this._onResize);
        this._unsubscribeUpdates?.();
        this._unsubscribeUpdates = null;
        this._updateBanner?.remove();
        this._updateBanner = null;
        document.documentElement.style.removeProperty('--navbar-height');
        document.documentElement.style.removeProperty('--navbar-right-edge');
        document.documentElement.style.removeProperty('--navbar-top');
    }

    initializeUtilityMenu() {
        this.restoreMenuBackground();
        this._menuOpen = false;
        const toggle = createButton({
            size: 'icon',
            ariaLabel: 'Templates and settings',
            onClick: () => this.setMenuOpen(!this._menuOpen),
        });
        toggle.classList.add('paper-button--touch-target', 'navbar-menu-toggle');
        toggle.setAttribute('aria-controls', 'navbarUtilityLinks');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path class="navbar-menu-line navbar-menu-line--top" d="M4 6h16" /><path class="navbar-menu-line navbar-menu-line--middle" d="M4 12h16" /><path class="navbar-menu-line navbar-menu-line--bottom" d="M4 18h16" /></svg>';
        this._menuToggle = toggle;
        this.querySelector('.navbar-steps').after(toggle);
        this.syncUtilityMenu();
    }

    setMenuOpen(open, returnFocus = false) {
        this._menuOpen = Boolean(open);
        this.syncUtilityMenu();
        if (returnFocus || this._menuOpen) this._menuToggle.focus();
        this.measureHeight();
    }

    syncUtilityMenu() {
        if (!this._menuToggle) return;
        const compact = window.matchMedia('(max-width: 1279px)').matches;
        const utilities = this.querySelector('.navbar-utilities');
        const steps = this.querySelector('.navbar-steps');
        const shell = this.querySelector('.navbar-shell');
        if (!compact) this._menuOpen = false;
        const open = compact && this._menuOpen;
        const focusInUtilities = utilities.contains(document.activeElement);
        utilities.hidden = false;
        utilities.inert = compact && !open;
        if (compact && !open) utilities.setAttribute('aria-hidden', 'true');
        else utilities.removeAttribute('aria-hidden');
        steps.inert = open;
        if (open) steps.setAttribute('aria-hidden', 'true');
        else steps.removeAttribute('aria-hidden');
        this._menuToggle.hidden = !compact;
        this._menuToggle.setAttribute('aria-expanded', String(open));
        this._menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Templates and settings');
        shell.dataset.menuOpen = String(open);
        if (open) {
            shell.setAttribute('role', 'dialog');
            shell.setAttribute('aria-modal', 'true');
            shell.setAttribute('aria-label', 'Templates and settings');
            this.lockMenuBackground();
        } else {
            shell.removeAttribute('role');
            shell.removeAttribute('aria-modal');
            shell.setAttribute('aria-label', 'Main navigation');
            this.restoreMenuBackground();
        }
        if (compact && !open && focusInUtilities) this._menuToggle.focus();
        else if (!compact && document.activeElement === this._menuToggle) utilities.querySelector('a').focus();
    }

    lockMenuBackground() {
        if (this._menuBackground) return;
        this._menuBackground = [...document.body.children]
            .filter(element => element !== this && !element.contains(this))
            .map(element => ({ element, inert: element.inert }));
        this._menuBackground.forEach(({ element }) => { element.inert = true; });
        const root = document.documentElement;
        this._menuScroll = { rootOverflow: root.style.overflow, bodyOverflow: document.body.style.overflow, gutter: root.style.scrollbarGutter };
        if (window.innerWidth > root.clientWidth) root.style.scrollbarGutter = 'stable';
        root.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
    }

    restoreMenuBackground() {
        this._menuBackground?.forEach(({ element, inert }) => { element.inert = inert; });
        this._menuBackground = null;
        if (this._menuScroll) {
            document.documentElement.style.overflow = this._menuScroll.rootOverflow;
            document.documentElement.style.scrollbarGutter = this._menuScroll.gutter;
            document.body.style.overflow = this._menuScroll.bodyOverflow;
            this._menuScroll = null;
        }
    }

    measureHeight() {
        const navbar = this.querySelector('.navbar-shell');
        if (navbar) {
            const rect = navbar.getBoundingClientRect();
            document.documentElement.style.setProperty('--navbar-height', `${Math.ceil(rect.bottom)}px`);
            document.documentElement.style.setProperty('--navbar-right-edge', `${rect.right - 2}px`);
            document.documentElement.style.setProperty('--navbar-top', `${rect.top}px`);
        }
    }

    observeHeight() {
        this._resizeObserver?.disconnect();
        this.measureHeight();
        if (window.ResizeObserver) {
            this._resizeObserver = new window.ResizeObserver(() => this.measureHeight());
            this._resizeObserver.observe(this.querySelector('.navbar-shell'));
        }
    }

    initializeUpdateBanner() {
        if (this._unsubscribeUpdates) return;
        let banner = document.getElementById('sharedUpdateBanner');
        if (!banner) {
            banner = document.createElement('section');
            banner.id = 'sharedUpdateBanner';
            banner.className = 'navbar-update-banner fixed right-4 z-20 hidden max-w-xl paper-element p-4 shadow-lg overflow-y-auto';
            banner.setAttribute('aria-live', 'polite');
            banner.setAttribute('aria-label', 'Application update');
            document.body.appendChild(banner);
        }
        this._updateBanner = banner;
        this._unsubscribeUpdates = updateControls.subscribe(state => this.renderUpdateBanner(banner, state));
        updateControls.refresh();
    }

    renderUpdateBanner(banner, state) {
        banner.replaceChildren();
        if (!state || !state.notificationVisible || !['available', 'downloading', 'ready-to-install', 'error'].includes(state.status)) {
            banner.classList.add('hidden');
            return;
        }
        banner.classList.remove('hidden');
        const heading = document.createElement('h2');
        heading.className = 'font-semibold text-primary-dark mb-1';
        heading.textContent = state.status === 'available' ? `Version ${state.availableVersion} is available` :
            state.status === 'downloading' ? 'Downloading update' :
            state.status === 'ready-to-install' ? 'Update is ready to install' : 'Update could not be completed';
        banner.appendChild(heading);
        const details = document.createElement('p');
        details.className = 'text-sm mb-3 whitespace-pre-wrap';
        details.id = 'sharedUpdateBannerNotes';
        details.style.maxHeight = '6rem';
        details.style.overflowY = 'auto';
        details.textContent = state.status === 'downloading' ? `${Math.round(state.progress || 0)}% downloaded` :
            state.status === 'ready-to-install' ? `Version ${state.availableVersion} is ready.` :
            state.status === 'error' ? (state.error || 'Try again or open the release page.') :
            `${state.canInstall ? '' : 'This update must be installed outside the app. Open the release page, download the installer, and quit before replacing the app.\n\n'}${state.releaseNotes || 'A newer version is ready to download.'}`;
        banner.appendChild(details);
        if (state.status === 'downloading') {
            const progress = document.createElement('progress');
            progress.className = 'w-full mb-3';
            progress.max = 100;
            progress.value = Number(state.progress) || 0;
            progress.setAttribute('aria-label', 'Update download progress');
            banner.appendChild(progress);
        }
        const actions = document.createElement('div');
        actions.className = 'flex flex-wrap gap-2';
        const addAction = (label, action) => {
            const button = createButton({ text: label, size: 'compact' });
            button.addEventListener('click', async () => {
                button.disabled = true;
                try { await action(); } catch (error) {
                    console.error('Update action failed', error);
                    let message = banner.querySelector('[role="alert"]');
                    if (!message) {
                        message = document.createElement('p');
                        message.setAttribute('role', 'alert');
                        message.className = 'text-sm text-red-800 whitespace-pre-wrap mb-2';
                        banner.insertBefore(message, actions);
                    }
                    message.textContent = error.message || String(error);
                }
                finally { button.disabled = false; }
            });
            actions.appendChild(button);
        };
        if (state.status === 'available') {
            addAction(state.canInstall ? 'Download update' : 'Open release page', state.canInstall ? updateControls.download : updateControls.openRelease);
        } else if (state.status === 'downloading') {
            addAction('Cancel download', updateControls.cancelDownload);
        } else if (state.status === 'ready-to-install') {
            addAction('Restart and install', updateControls.install);
        } else if (state.status === 'error') {
            addAction('Try again', updateControls.check);
            addAction('Open release page', updateControls.openRelease);
        }
        if (state.status !== 'downloading') addAction('Later', updateControls.dismiss);
        banner.appendChild(actions);
    }

    updateActiveState() {
        const currentPath = window.location.pathname;
        if (currentPath.includes('/Home/')) {
            this.setAttribute('current-step', '1');
        } else if ((currentPath.includes('/MagicTheGathering/') || currentPath.includes('/CardList/'))) {
            this.setAttribute('current-step', '2');
        } else if (currentPath.includes('/CreatePDF/')) {
            this.setAttribute('current-step', '3');
        } else if (currentPath.includes('/Settings/') || currentPath.includes('/Tools/')) {
            this.setAttribute('current-step', '0');
        }
    }

    updateContent() {
        const currentPath = window.location.pathname;
        const isSettingsActive = currentPath.includes('/Settings/');
        const isToolsActive = currentPath.includes('/Tools/');
        const attr = this.getAttribute('current-step');
        const currentStep = isSettingsActive || isToolsActive ? 0 : (attr === null ? 1 : Number(attr));
        const explicitGame = currentPath.includes('/CardList/') ? new URLSearchParams(window.location.search).get('game') : null;
        const { games } = require(path.join(__dirname, '../shared/cardList/gameRegistry.js'));
        let savedGame;
        try { savedGame = sessionStorage.getItem('activeGame'); } catch (_) { /* Use MTG when storage is unavailable. */ }
        const activeGame = currentPath.includes('/MagicTheGathering/') ? 'mtg' :
            Object.hasOwn(games, explicitGame) ? explicitGame : Object.hasOwn(games, savedGame) ? savedGame : 'mtg';
        this.innerHTML = `
            <nav class="navbar-shell paper-surface" aria-label="Main navigation">
                <span class="navbar-wordmark">Silhouette</span>
                <ol class="navbar-steps" aria-label="Card creation steps">
                    ${this.renderStep(1, 'Choose Game', '../Home/home.html', currentStep)}
                    ${this.renderStep(2, 'Card List', '../CardList/decklist.html?game=' + activeGame, currentStep)}
                    ${this.renderStep(3, 'Create PDF', '../CreatePDF/create.html', currentStep)}
                </ol>
                <div class="navbar-erase-overlay" aria-hidden="true"><div class="navbar-erase-mask"><span class="navbar-erase-edge"></span></div></div>
                <div class="navbar-menu-backdrop" aria-hidden="true"></div>
                <div id="navbarUtilityLinks" class="navbar-utilities paper-button-group paper-button-group--sidebar" role="group" aria-label="Tools and settings">
                    <a href="../Tools/tools.html" title="Cutting templates" aria-label="Cutting templates" class="paper-button paper-button--compact"${isToolsActive ? ' aria-current="page"' : ''}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 3 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5" /></svg>
                        <span>Templates</span>
                    </a>
                    <a href="../Settings/settings.html" title="Settings" class="paper-button paper-button--compact"${isSettingsActive ? ' aria-current="page"' : ''}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9.5 3-.6 2.4-2 .9-2.2-.7-2.5 4.2 1.8 1.7v2.2l-1.8 1.7 2.5 4.2 2.2-.7 2 .9.6 2.2h5l.6-2.2 2-.9 2.2.7 2.5-4.2-1.8-1.7v-2.2l1.8-1.7-2.5-4.2-2.2.7-2-.9-.6-2.4h-5Z" /><circle cx="12" cy="12" r="3" /></svg>
                        <span>Settings</span>
                    </a>
                </div>
            </nav>
        `;
        if (this.isConnected) {
            this.initializeUtilityMenu();
            this.observeHeight();
        }
    }

    renderStep(step, label, href, currentStep) {
        const isCurrent = step === currentStep;
        const isEarlier = currentStep > 0 && step < currentStep;
        return `
            <li>
                <a href="${href}" class="navbar-step"${isCurrent ? ' aria-current="step"' : ''}>
                    <span class="navbar-step-marker navbar-step-number" aria-hidden="true">${step}${isEarlier ? '<span class="navbar-completion-badge"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" focusable="false"><path d="m4 8 3 3 5-6" /></svg></span>' : ''}</span>
                    <span class="navbar-step-label">${label}</span>
                    ${isEarlier ? '<span class="sr-only">(completed step)</span>' : ''}
                </a>
            </li>
        `;
    }
}

customElements.define('nav-bar', Navbar);
})();
