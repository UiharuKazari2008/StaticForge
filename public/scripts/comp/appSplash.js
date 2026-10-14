// Application splash screens (Yozora #468). One controller per splash element; the 800x450 frame
// is shared by DreamStudio (#manualModalSplash, still driven by manualModalManager.js) and
// Workspaces (#workspaceSplash) in manual-modal-splash.css. Desktop mode only.
//
// show() stamps the start. hide() keeps the splash up for the rest of the minimum display time and
// for at least the linger after the window has loaded (Yukimi: 3 s minimum, 1.5 s after load), then
// calls onHidden. setProgress() draws the gallery load progress in the splash's corner on the
// 7.css progress bar instead of the small loading dialog (galleryView.js updateGalleryDataProgress).
// applyGalleryProgressBarState / formatGalleryProgressStatusText: public/scripts/comp/workspaceUtils.js
class AppSplash {
    constructor(id, options) {
        const opts = options || {};
        this.el = document.getElementById(id);
        this.minDisplayMs = opts.minDisplayMs || 3000;
        this.lingerMs = opts.lingerMs || 1500;
        this.startedAt = 0;
        this.closeTimer = null;
        this.progressSwitched = false;
        this.statusText = this.el ? this.el.querySelector('.splash-status-text') : null;
        this.progress = this.el ? this.el.querySelector('.splash-progress') : null;
        this.progressBar = this.progress ? this.progress.firstElementChild : null;
    }

    isActive() {
        return !!this.el && !this.el.classList.contains('hidden');
    }

    /** Show the splash (desktop mode only). Returns whether it is showing. */
    show(status) {
        if (!window.isDesktop || !this.el) return false;
        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
        this.startedAt = Date.now();
        this.progressSwitched = false;
        if (this.progress) {
            this.progress.classList.add('hidden', 'marquee');
            this.progress.setAttribute('aria-valuenow', '0');
            if (this.progressBar) this.progressBar.style.width = '';
        }
        if (typeof status === 'string') this.setStatus(status);
        this.el.classList.remove('hidden');
        return true;
    }

    setStatus(text) {
        if (this.isActive() && this.statusText) this.statusText.textContent = text;
    }

    /** Gallery load progress (phase, progress 0..1, blocks): bar + status line in the corner. */
    setProgress(progress) {
        if (!this.isActive() || !this.progress) return;
        this.progress.classList.remove('hidden');
        const modeRef = { value: this.progressSwitched };
        this.progressSwitched = applyGalleryProgressBarState(this.progress, this.progressBar, progress, modeRef);
        this.setStatus(formatGalleryProgressStatusText(progress));
    }

    /** Hide after the minimum display time and the linger; a later call restarts the linger. */
    hide(onHidden) {
        if (!this.isActive()) {
            if (typeof onHidden === 'function') onHidden();
            return;
        }
        const remaining = this.minDisplayMs - (Date.now() - this.startedAt);
        const wait = Math.max(remaining, this.lingerMs);
        if (this.closeTimer) clearTimeout(this.closeTimer);
        this.closeTimer = setTimeout(() => {
            this.closeTimer = null;
            this.el.classList.add('hidden');
            if (typeof onHidden === 'function') onHidden();
        }, wait);
    }
}

// Workspaces (modalUtils.js showGalleryWindow opens it; galleryView.js routes the load progress)
const workspaceSplash = new AppSplash('workspaceSplash', { minDisplayMs: 3000, lingerMs: 1500 });
