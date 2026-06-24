// Exit confirmation: page leave, refresh, tab close, and external link navigation guards.
// Extracted from public/scripts/app.js (L12738–12891).

let isExiting = false;

async function showExitConfirmation(event, action = 'leave') {
    if (isExiting) return;

    const messages = {
        leave: 'Are you sure you want to leave the application?',
        refresh: 'Are you sure you want to restart the application?',
        close: 'Are you sure you want to close the application?'
    };

    const message = messages[action] || messages.leave;

    try {
        const confirmed = await showConfirmationDialog(message, [
            { text: 'Yes, Leave', value: true, className: 'btn-danger' },
            { text: 'Stay', value: false, className: 'btn-secondary' }
        ], event);

        if (confirmed) {
            isExiting = true;
            window.bypassConfirmation = true;

            if (action === 'refresh') {
                window.location.reload();
                return;
            }

            if (action === 'close') {
                try {
                    window.close();
                } catch (e) {
                    // Browser security prevents programmatic tab closing
                }
                return;
            }

            if (event && event.target) {
                event.stopImmediatePropagation();
                if (event.target.click) {
                    event.target.click();
                }
            }
        } else if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
    } catch (error) {
        console.error('Error showing exit confirmation:', error);
        if (event) {
            event.preventDefault();
        }
    }
}

function wireExitConfirmationListeners() {
    if (window._exitConfirmationListenersWired) return;
    window._exitConfirmationListenersWired = true;

    window.showExitConfirmation = showExitConfirmation;

    window.addEventListener('beforeunload', (event) => {
        if (typeof __dreamscapeFatalNavBypass !== 'undefined' && __dreamscapeFatalNavBypass) {
            return;
        }
        if (window.bypassConfirmation) {
            return;
        }
        event.preventDefault();
        event.returnValue = '';
        return '';
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // Page is now hidden (user switched tabs)
        }
    });

    window.addEventListener('popstate', (event) => {
        event.preventDefault();
        showExitConfirmation(event, 'leave');
    });

    document.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (link && link.href && !link.target && !link.hasAttribute('download')) {
            if (link.classList.contains('tag-wiki-link')
                || link.classList.contains('quip-wiki-nav-link')
                || link.classList.contains('wiki-static-link')
                || link.classList.contains('wiki-static-index-link')
                || link.classList.contains('tag-wiki-anchor-link')) {
                return;
            }

            const href = link.href;
            const currentOrigin = window.location.origin;

            try {
                const linkUrl = new URL(href);
                const pageUrl = new URL(window.location.href);
                if (linkUrl.origin === pageUrl.origin
                    && linkUrl.pathname === pageUrl.pathname
                    && linkUrl.search === pageUrl.search) {
                    return;
                }
            } catch (_) {
                // fall through to origin check
            }

            if (href.startsWith(currentOrigin) && href !== window.location.href) {
                event.preventDefault();
                showExitConfirmation(event, 'close');
            }
        }
    });

    window.forceRefresh = () => {
        window.bypassConfirmation = true;
        window.location.reload();
    };

    window.forceClose = () => {
        try {
            window.close();
        } catch (e) {
            showGlassToast('info', 'Close Tab', 'Please close this tab manually using Ctrl+W or the close button', false, 3000);
        }
    };
}

wireExitConfirmationListeners();
