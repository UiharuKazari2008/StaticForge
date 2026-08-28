class GenerationUsageToolManager {
    constructor() {
        this.element = null;
        this.genCountWired = false;
        this.extendedUsageToastShown = false;
    }

    init() {
        this.element = document.getElementById('generationUsageTool');
        if (this.element) {
            transientWindowsWithPositions.add('generation-usage-tool');
            linkToolWindowToParent(this.element, document.getElementById('manualModal'));
            if (!this.element.querySelector('.resize-handle')) {
                addResizeHandles(this.element);
            }
            document.getElementById('generationUsageCloseBtn').addEventListener('click', () => {
                void closeModal(this.element);
            });
        }
        this.wireGenCountClick();
        this.sync();
    }

    wireGenCountClick() {
        if (this.genCountWired) return;
        const genCount = document.getElementById('manualGenCountDisplay');
        if (!genCount) return;
        this.genCountWired = true;
        genCount.classList.add('clickable');
        genCount.setAttribute('role', 'button');
        genCount.tabIndex = 0;
        const openUsage = (event) => {
            event.preventDefault();
            this.open();
        };
        genCount.addEventListener('click', openUsage);
        genCount.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                openUsage(event);
            }
        });
    }

    getUsage() {
        return window.optionsData?.opusUsage || window.optionsData?.user?.subscription?.usage || null;
    }

    isOpus() {
        const subscription = window.optionsData?.user?.subscription;
        const tier = Number(subscription?.tier);
        return Number.isFinite(tier) && tier === 3 && subscription?.active !== false;
    }

    remainingPercent(usage) {
        if (!usage) return null;
        if (usage.isNegative) return 0;
        return Math.max(0, Number(usage.percent) || 0);
    }

    usedPercent(usage) {
        const remaining = this.remainingPercent(usage);
        return remaining == null ? null : Math.max(0, Math.round(100 - remaining));
    }

    remainingGens(usage) {
        const remaining = this.remainingPercent(usage);
        // NovelAI chunk 52 / module 42283: Math.round(17.3 * percent)
        return remaining == null ? null : Math.round(17.3 * remaining);
    }

    refillPercentPerDay(usage) {
        const seconds = Number(usage?.timeUntilNextPercent);
        return seconds > 0 ? Math.round((86400 / seconds) * 10) / 10 : 0;
    }

    isRefillPaused(usage) {
        const remaining = this.remainingPercent(usage);
        const refill = this.refillPercentPerDay(usage);
        return remaining != null && (remaining >= 100 || refill <= 0);
    }

    recentImageCount() {
        // imageCount: public/scripts/comp/connectionManager.js
        return typeof imageCount === 'number' ? imageCount : 0;
    }

    isHigh(usage) {
        const used = this.usedPercent(usage);
        return used != null && (usage.isNegative === true || used >= 95);
    }

    emptySnapshot(extra) {
        return {
            isOpus: false,
            usage: null,
            percent: null,
            remaining: null,
            remainingPercent: null,
            refillPercent: 0,
            refillGenerations: 0,
            refillPaused: false,
            extended: false,
            extraPercent: 0,
            high: false,
            compactLabel: '—',
            title: '24h generation count',
            iconClass: 'fas fa-battery-slash',
            showBar: false,
            barPercent: 0,
            ...extra
        };
    }

    /**
     * Account-level V5 usage (inverted remaining battery).
     * Ping / get_app_options / retry_account_data push opusUsage; this only paints it.
     * @returns {object}
     */
    getSnapshot() {
        const isOpus = this.isOpus();
        const usage = this.getUsage();
        if (!isOpus) {
            return this.emptySnapshot({ isOpus: false });
        }
        if (!usage) {
            return this.emptySnapshot({
                isOpus: true,
                high: true,
                title: '24h generation count — V5 usage unavailable',
                iconClass: 'fas fa-battery-exclamation'
            });
        }
        const percent = this.usedPercent(usage);
        const remainingPercent = this.remainingPercent(usage);
        const remaining = this.remainingGens(usage);
        const refillPercent = this.refillPercentPerDay(usage);
        const refillPaused = this.isRefillPaused(usage);
        const refillGenerations = Math.round(17.3 * refillPercent);
        const high = this.isHigh(usage);
        const extended = remainingPercent > 100;
        const extraPercent = extended ? Math.round(remainingPercent - 100) : 0;
        const compactLabel = extended ? `+${extraPercent}%` : `${percent}%`;
        const title = extended
            ? `24h ${this.recentImageCount()} — Extended free usage (+${extraPercent}%, ${remainingPercent}% remaining, ~${remaining} left)`
            : `24h ${this.recentImageCount()} — V5 usage ${percent}% (~${remaining} left)`;
        return {
            isOpus: true,
            usage,
            percent,
            remainingPercent,
            remaining,
            refillPercent,
            refillGenerations,
            refillPaused,
            extended,
            extraPercent,
            high,
            compactLabel,
            title,
            iconClass: high ? 'fas fa-battery-empty' : (extended ? 'fas fa-battery-full' : 'fas fa-battery-three-quarters'),
            showBar: true,
            barPercent: extended ? 100 : Math.min(100, percent)
        };
    }

    updateUsage(usage) {
        if (window.optionsData) window.optionsData.opusUsage = usage || null;
        this.sync();
    }

    sync() {
        const snap = this.getSnapshot();
        const genCount = document.getElementById('manualGenCountDisplay');
        if (genCount) genCount.title = snap.title;
        const usageSplit = document.getElementById('manualGenUsageSplit');
        const usageEl = document.getElementById('manualGenUsagePercent');
        if (usageSplit) usageSplit.classList.toggle('hidden', !snap.isOpus);
        if (usageEl) usageEl.textContent = snap.isOpus ? snap.compactLabel : '';
        this.render();
        this.updateExternalSurfaces();
        this.notifyExtendedUsage();
    }

    /**
     * One toast per session while remaining is over 100% (V5 launch +100% boost).
     * @param {{ forceDisplay?: boolean }} [options]
     */
    notifyExtendedUsage(options = {}) {
        const snap = this.getSnapshot();
        if (!snap.isOpus || !snap.usage) return;
        if (!snap.extended) {
            this.extendedUsageToastShown = false;
            return;
        }
        if (this.extendedUsageToastShown) return;
        // shouldDeferTrayNotifications: public/scripts/comp/trayIndicators.js
        if (!options.forceDisplay && shouldDeferTrayNotifications()) return;

        this.extendedUsageToastShown = true;
        showGlassToast(
            'success',
            'Extended Free Usage',
            `Opus V5 got a one-time +100% usage boost for launch, which can go past the normal 100% cap.<br/>You have <strong>${snap.remainingPercent}%</strong> remaining (~${snap.remaining} free gens, +${snap.extraPercent}% extra). Refill stays paused until you drop below 100%.`,
            false,
            20000,
            '<i class="fas fa-battery-full"></i>',
            [{ text: 'Open', type: 'primary', closeOnClick: true, onClick: () => this.open() }]
        );
    }

    /**
     * Fill Anlas context-menu usage row (main menu or tray). Call from menu loadfn.
     * @param {string} [suffix] - '' or 'Tray'
     */
    fillAnlasMenuUsageRow(suffix = '') {
        const row = document.getElementById(`contextAnlasOpusUsageRow${suffix}`);
        const valueEl = document.getElementById(`contextAnlasOpusUsage${suffix}`);
        const iconEl = document.getElementById(`contextAnlasOpusUsageIcon${suffix}`);
        if (!row || !valueEl) return;

        const snap = this.getSnapshot();
        row.classList.toggle('hidden', !snap.isOpus);
        if (!snap.isOpus) return;

        valueEl.textContent = snap.remaining != null
            ? (snap.extended
                ? `Extended +${snap.extraPercent}% (~${snap.remaining})`
                : `${snap.compactLabel} (~${snap.remaining})`)
            : snap.compactLabel;
        row.title = snap.title;
        row.classList.toggle('low-credits', snap.high);
        if (iconEl) iconEl.className = snap.iconClass;
    }

    updateExternalSurfaces() {
        this.fillDataMgmtAccountUsage();
        this.fillAnlasMenuUsageRow('');
        this.fillAnlasMenuUsageRow('Tray');
    }

    fillDataMgmtAccountUsage() {
        const host = document.getElementById('dataMgmtOpusUsageHost');
        if (!host) return;
        const snap = this.getSnapshot();
        const valueEl = document.getElementById('dataMgmtOpusUsageValue');
        const fillEl = document.getElementById('dataMgmtOpusUsageFill');

        host.classList.toggle('hidden', !snap.isOpus);
        if (!snap.isOpus) return;

        if (valueEl) {
            valueEl.textContent = snap.remaining != null
                ? (snap.extended
                    ? `Extended free +${snap.extraPercent}% (~${snap.remaining} left)`
                    : `${snap.compactLabel} (~${snap.remaining} left)`)
                : snap.compactLabel;
        }
        if (fillEl) {
            fillEl.style.width = snap.showBar ? `${Math.min(100, snap.barPercent)}%` : '0%';
            fillEl.classList.toggle('low', snap.high);
        }
    }

    render() {
        if (!this.element) return;
        const snap = this.getSnapshot();
        const recentCount = this.recentImageCount();
        const dayCountEl = document.getElementById('generationUsageDayCount');
        const remainingEl = document.getElementById('generationUsageRemaining');
        const refillEl = document.getElementById('generationUsageRefill');
        const valueEl = document.getElementById('generationUsagePercent');
        const statusLabel = document.getElementById('generationUsageStatusLabel');
        const fillEl = document.getElementById('generationUsageFill');
        const comparisonEl = document.getElementById('generationUsageDayComparison');
        if (!valueEl || !fillEl) return;

        if (dayCountEl) dayCountEl.textContent = String(recentCount);

        if (!snap.isOpus || !snap.usage) {
            if (statusLabel) statusLabel.textContent = 'Usage';
            if (remainingEl) remainingEl.textContent = '—';
            if (refillEl) refillEl.textContent = '—';
            valueEl.textContent = '—';
            fillEl.style.width = '0';
            fillEl.classList.remove('low');
            if (comparisonEl) comparisonEl.textContent = `${recentCount} generated`;
            return;
        }

        if (statusLabel) statusLabel.textContent = snap.extended ? 'Extended' : 'Usage';
        if (remainingEl) {
            remainingEl.textContent = snap.extended
                ? `~${snap.remaining} (${snap.remainingPercent}%)`
                : `~${snap.remaining}`;
        }
        if (refillEl) {
            refillEl.textContent = snap.extended
                ? 'Paused (full)'
                : (snap.refillPaused
                    ? 'Paused'
                    : `${snap.refillPercent}% / day (~${snap.refillGenerations})`);
        }
        valueEl.textContent = snap.extended
            ? `Free +${snap.extraPercent}%`
            : snap.compactLabel;
        fillEl.style.width = `${Math.min(100, snap.barPercent)}%`;
        fillEl.classList.toggle('low', snap.high);
        if (comparisonEl) {
            comparisonEl.textContent = snap.extended
                ? `${recentCount} generated / extended free`
                : (snap.refillPaused
                    ? `${recentCount} generated / refill paused`
                    : `${recentCount} generated / ~${snap.refillGenerations} refilled`);
        }
    }

    open() {
        this.render();
        if (!this.element) return;
        openModal(this.element);
        bringModalToFront(this.element);
    }
}

const usageToolManager = new GenerationUsageToolManager();

wsClient.registerInitStep(36, 'Initializing generation usage tool', async () => {
    usageToolManager.init();
});
