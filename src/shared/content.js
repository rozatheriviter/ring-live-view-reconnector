// Debug mode - set to true to see detailed logs
const DEBUG = true;

// Immediately log that the script is loaded
console.log('[Ring Reconnector] Content script loaded and initialized (Overkill Mode)');

// Function to check if we're in Firefox
const isFirefox = typeof browser !== 'undefined';
console.log(`[Ring Reconnector] Running in ${isFirefox ? 'Firefox' : 'Chrome'}`);

function debugLog(message, isImportant = false) {
    if (DEBUG && (isImportant || !document.body)) {
        console.log(`[Ring Reconnector Debug] ${message}`);
    }
}

// Function to inject styles once document.head is available
function injectStyles() {
    if (!document.head) {
        return false;
    }

    const style = document.createElement('style');
    style.textContent = `
        @keyframes rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        .ring-reconnector-notification {
            position: fixed;
            top: 29px;
            right: 68px;
            width: 22px;
            height: 24px;
            z-index: 2147483647; /* Max z-index */
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
            pointer-events: none;
            filter: drop-shadow(0 0 2px rgba(33, 150, 243, 0.3));
        }
        
        .ring-reconnector-notification.show {
            opacity: 1;
        }
        
        .ring-reconnector-notification svg {
            width: 100%;
            height: 100%;
            animation: rotate 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .ring-reconnector-notification circle {
            stroke: url(#ring-gradient);
        }
    `;
    document.head.appendChild(style);
    return true;
}

// Ensure the script runs as early as possible
function initialize() {
    debugLog('Starting initialization...', true);

    try {
        // Create the notification element
        const notification = document.createElement('div');
        notification.className = 'ring-reconnector-notification';
        notification.title = 'Ring Live View Reconnector - Automatically reconnecting...';
        notification.innerHTML = `
            <svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#2196F3;stop-opacity:1" />
                        <stop offset="50%" style="stop-color:#90CAF9;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#2196F3;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <circle cx="15" cy="15" r="12" fill="none" stroke-width="3" stroke-linecap="round" stroke-dasharray="56 20"/>
            </svg>
        `;

        // Function to ensure notification is in the correct position
        function insertNotification() {
            // Try to find a stable container
            const header = document.querySelector('[data-testid="video-player-header"]') || document.body;
            if (header) {
                if (!document.body.contains(notification)) {
                    document.body.appendChild(notification);
                    return true;
                }
            }
            return false;
        }

        // Function to show the notification
        function showReconnectNotification() {
            debugLog('Showing reconnection notification', true);
            notification.classList.add('show');
            setTimeout(() => {
                notification.classList.remove('show');
            }, 2000);
        }

        // --- OVERKILL UTILITIES ---

        /**
         * Simulates a full mouse click sequence on an element.
         * React and other frameworks often listen to specific events.
         */
        function simulateClick(element) {
            const events = ['mouseover', 'mousedown', 'mouseup', 'click'];
            events.forEach(eventType => {
                const event = new MouseEvent(eventType, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    buttons: 1
                });
                element.dispatchEvent(event);
            });
            // Also try native click if available
            if (typeof element.click === 'function') {
                element.click();
            }
        }

        /**
         * Recursively traverses the DOM, including open Shadow Roots.
         * Yields every element found.
         */
        function* traverseDOM(root) {
            if (!root) return;

            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT,
                null,
                false
            );

            let node = walker.nextNode();
            while (node) {
                yield node;

                // If the element has an open shadow root, traverse it
                if (node.shadowRoot) {
                    yield* traverseDOM(node.shadowRoot);
                }

                node = walker.nextNode();
            }
        }

        /**
         * Checks if an element is visible.
         */
        function isVisible(elem) {
            if (!elem) return false;
            // Basic checks
            if (elem.style && (elem.style.display === 'none' || elem.style.visibility === 'hidden')) return false;
            if (elem.hasAttribute('hidden')) return false;

            // Expensive check, but needed for accuracy
            const rect = elem.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }

        // Target Texts (Lowercase for case-insensitive matching)
        const RECONNECT_TEXTS = [
            'reconnect',
            'reconnect again',
            'verbindung wiederherstellen',
            'reconectar',
            'reconnecter',
            'riconnetti',
            'opnieuw verbinden',
            'yeniden bağlan',
            'připojit znovu',
            'połącz ponownie',
            'переподключиться',
            'újracsatlakozás',
            '重新连接',
            '再接続'
        ];

        function isReconnectButton(element) {
            // 1. Check for button-like traits
            const isButtonTag = element.tagName === 'BUTTON';
            const isButtonRole = element.getAttribute('role') === 'button';
            const isClickableDiv = (element.tagName === 'DIV' || element.tagName === 'A' || element.tagName === 'SPAN') &&
                                   (element.className.toLowerCase().includes('btn') || element.className.toLowerCase().includes('button'));

            if (!isButtonTag && !isButtonRole && !isClickableDiv) {
                return false;
            }

            // 2. Check text content (deep)
            // We use innerText to get visible text, or textContent as fallback
            const text = (element.innerText || element.textContent || '').trim().toLowerCase();
            if (!text) return false;

            // 3. Match against known strings
            // Exact match or includes? "Reconnect" is short, so includes might be risky (e.g. "Disconnect").
            // But "Reconnect Again" contains "Reconnect".
            // Let's use `includes` but be careful.

            // To prevent false positives like "Disconnect", we check if it includes target texts.
            // But "Disconnect" doesn't include "Reconnect".
            return RECONNECT_TEXTS.some(target => text.includes(target));
        }

        // Function to click the reconnect button
        function clickReconnectButton() {
            // Method 1: Legacy Selectors (Fastest if they work)
            const legacySelectors = [
                'button[data-testid="modal__accept-button"]',
                '[data-testid="live-view__global-reconnect-modal"] button'
            ];

            for (const selector of legacySelectors) {
                const btn = document.querySelector(selector);
                if (btn && isVisible(btn)) {
                    debugLog('Found reconnect button via legacy selector', true);
                    simulateClick(btn);
                    showReconnectNotification();
                    return true;
                }
            }

            // Method 2: Overkill Deep Search (Shadow DOM + Fuzzy Text)
            // We iterate EVERYTHING. This is heavy but "overkill" was requested.
            // Optimization: Maybe only search if we suspect a modal is open?
            // No, user said "forces user to click", implies it's visible.

            // To avoid killing CPU, we limit this full scan frequency or break early.

            let found = false;

            // We traverse document.body
            if (!document.body) return false;

            // Strategy: Look for text nodes? Or just elements?
            // Traversing elements is easier for checking attributes.
            const allElements = traverseDOM(document.body);

            for (const element of allElements) {
                if (isReconnectButton(element) && isVisible(element)) {
                    debugLog(`Found reconnect button via Deep Search: <${element.tagName}> "${element.innerText}"`, true);
                    simulateClick(element);
                    showReconnectNotification();
                    found = true;
                    // Don't return immediately, in case there are multiple (e.g. overlays), ensure we hit it.
                    // But usually one is enough.
                    return true;
                }
            }

            return found;
        }

        // --- SCHEDULING ---

        // 1. MutationObserver: React to DOM changes
        const observer = new MutationObserver((mutations) => {
            // Debounce slightly?
            // If significant nodes added or attributes changed
            let shouldCheck = false;
            for (const m of mutations) {
                if (m.type === 'childList' && m.addedNodes.length > 0) shouldCheck = true;
                if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class' || m.attributeName === 'hidden')) shouldCheck = true;
            }

            if (shouldCheck) {
                clickReconnectButton();
            }
        });

        function startObserving() {
            if (document.body) {
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
                });
                return true;
            }
            return false;
        }

        // 2. Polling: "Overkill" backup
        // Run every 2 seconds regardless of mutations, just in case.
        setInterval(clickReconnectButton, 2000);

        // Function to complete initialization
        function completeInitialization() {
            injectStyles();
            startObserving();
            insertNotification();

            // Initial check
            clickReconnectButton();

            debugLog('Initialization complete (Overkill Mode)', true);
        }

        // Start
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', completeInitialization);
        } else {
            completeInitialization();
        }

    } catch (error) {
        console.error('[Ring Reconnector] Initialization error:', error);
    }
}

// Start initialization
initialize();
