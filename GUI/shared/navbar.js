(() => {
const path = require('path');
const updateControls = require(path.join(__dirname, '../shared/updateControls.js'));

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
        this.updateContent();
        // Update active state based on current URL
        this.updateActiveState();
        // Listen for navigation events
        window.addEventListener('popstate', () => this.updateActiveState());
        this.initializeUpdateBanner();
    }

    initializeUpdateBanner() {
        if (this._unsubscribeUpdates) return;
        let banner = document.getElementById('sharedUpdateBanner');
        if (!banner) {
            banner = document.createElement('section');
            banner.id = 'sharedUpdateBanner';
            banner.className = 'fixed top-20 right-4 z-20 hidden max-w-xl paper-element p-4 shadow-lg overflow-y-auto';
            banner.style.maxHeight = 'calc(100vh - 6rem)';
            banner.setAttribute('aria-live', 'polite');
            banner.setAttribute('aria-label', 'Application update');
            document.body.appendChild(banner);
        }
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
        const addAction = (label, action, primary = false) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = primary ? 'paper-button py-2 px-3' : 'paper-button py-2 px-3';
            button.textContent = label;
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
            addAction(state.canInstall ? 'Download update' : 'Open release page', state.canInstall ? updateControls.download : updateControls.openRelease, true);
        } else if (state.status === 'downloading') {
            addAction('Cancel download', updateControls.cancelDownload);
        } else if (state.status === 'ready-to-install') {
            addAction('Restart and install', updateControls.install, true);
        } else if (state.status === 'error') {
            addAction('Try again', updateControls.check, true);
            addAction('Open release page', updateControls.openRelease);
        }
        if (state.status !== 'downloading') addAction('Later', updateControls.dismiss);
        banner.appendChild(actions);
    }

    updateActiveState() {
        const currentPath = window.location.pathname;
        if (currentPath.includes('/Home/')) {
            this.setAttribute('current-step', '1');
        } else if (currentPath.includes('/MagicTheGathering/')) {
            this.setAttribute('current-step', '2');
        } else if (currentPath.includes('/CreatePDF/')) {
            this.setAttribute('current-step', '3');
        } else if (currentPath.includes('/Settings/')) {
            this.setAttribute('current-step', '0');
        }
    }

    updateContent() {
        const attr = this.getAttribute('current-step');
        const currentStep = attr === null ? 1 : parseInt(attr);
        const isSettingsActive = currentStep === 0;
        const settingsLinkClasses = 'absolute right-8 top-1/2 -translate-y-1/2 rounded-full p-2 transition-all duration-200 ' +
            (isSettingsActive
                ? 'bg-content-light text-surface opacity-100'
                : 'text-content-light opacity-70 hover:opacity-100');
        this.innerHTML = `
            <nav class="fixed top-0 left-0 right-0 paper-surface backdrop-blur-sm z-10">
                <div class="w-full flex justify-center px-8 py-4">
                    <div class="w-[600px] flex items-center justify-center">
                        <div class="flex items-center justify-between w-full max-w-[500px]">
                            ${this.renderStep(1, 'Choose Game', '../Home/home.html', currentStep)}
                            <div class="w-16 h-0.5 bg-content-light/30">&nbsp;</div>
                            ${this.renderStep(2, 'Card List', '../MagicTheGathering/decklist.html', currentStep)}
                            <div class="w-16 h-0.5 bg-content-light/30">&nbsp;</div>
                            ${this.renderStep(3, 'Create PDF', '../CreatePDF/create.html', currentStep)}
                        </div>
                    </div>
                    <a href="../Settings/settings.html" title="Settings" class="${settingsLinkClasses}">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </a>
                </div>
            </nav>
        `;
    }

    renderStep(step, label, href, currentStep) {
        const isCurrent = step === currentStep;
        const linkClasses = 'flex-shrink-0 group relative flex justify-center ' + 
            (isCurrent ? '' : 'opacity-70 hover:opacity-100 transition-opacity');
        
        const containerClasses = 'flex items-center transition-all duration-200 rounded-full border-2 border-dashed border-content-light overflow-hidden whitespace-nowrap ' +
            (isCurrent ? 'w-full px-4 bg-content-light text-surface font-medium' : 'w-8 h-8 group-hover:w-full group-hover:px-4 bg-surface-light text-content');

        const numberClasses = 'w-8 h-8 flex items-center justify-center absolute left-0';
        const labelClasses = 'pl-4 transition-all duration-200 overflow-hidden ' +
            (isCurrent ? 'opacity-100 w-auto' : 'opacity-0 w-0 group-hover:w-auto group-hover:opacity-100');

        return `
            <a href="${href}" class="${linkClasses}">
                <div class="${containerClasses}">
                    <div class="${numberClasses}">${step}</div>
                    <div class="${labelClasses}">${label}</div>
                </div>
            </a>
        `;
        }
}

customElements.define('nav-bar', Navbar);
})();
