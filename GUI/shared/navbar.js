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
        `;r();
        }
}

customElements.define('nav-bar', Navbar);