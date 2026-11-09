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
            document.getElementById('generationUsageCloseBtn')?.addEventListener('click', () => {
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

    getCurrentDrainMultiplier() {
        if (!this.isOpus()) return 1.0;

        const manualUpscale = document.getElementById('manualUpscale');
        if (manualUpscale && manualUpscale.getAttribute('data-state') === 'on') {
            return 0; // Upscale does NOT use Opus meter
        }

        const model = typeof window.getCurrentSelectedModel === 'function' ? String(window.getCurrentSelectedModel() || '').toLowerCase() : '';
        const isV5Full = model === 'v5' || (model.startsWith('v5_') && model !== 'v5_cur');
        const isV5Curated = model === 'v5_cur';

        if (!isV5Full && !isV5Curated) {
            return 0;
        }

        const isInpaint = !!window.currentMaskData;
        if (isInpaint) {
            // Inpaint drains meter on V5 Full; V5 Curated inpaint is still V4.5 Curated path (not V5F meter).
            if (isV5Curated) return 0;
            return 1.0;
        }

        const isImg2Img = !!window.uploadedImageData || !!(window.currentEditMetadata && window.currentEditMetadata.isVariationEdit);
        if (isImg2Img) {
            // V5 Opus img2img meter drain follows Strength, not Noise.
            const strengthEl = document.getElementById('manualStrengthValue') || document.getElementById('manualStrength');
            let strength = 1.0;
            if (strengthEl) {
                strength = Number(strengthEl.value !== undefined ? strengthEl.value : strengthEl.textContent);
            }
            if (!Number.isFinite(strength)) strength = 1.0;
            return strength;
        }

        return 1.0;
    }

    remainingGens(usage) {
        const remaining = this.remainingPercent(usage);
        if (remaining == null) return null;

        const drain = this.getCurrentDrainMultiplier();
        if (drain <= 0) return 'Free';

        // NovelAI chunk 52 / module 42283: Math.round(17.3 * percent)
        return Math.round((17.3 * remaining) / drain);
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
     * The server polls GET /user/subscription .usage about every 60s and pushes opusUsage.
     * Login /user/data usage is only the first paint. image_count is the 24h counter.
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
        const drain = this.getCurrentDrainMultiplier();
        const remainingText = drain > 0 ? `~${remaining}` : 'Free';
        const refillPercent = this.refillPercentPerDay(usage);
        const refillPaused = this.isRefillPaused(usage);
        const refillGenerations = drain > 0 ? Math.round((17.3 * refillPercent) / drain) : 'Free';
        const high = this.isHigh(usage);
        const extended = remainingPercent > 100;
        const extraPercent = extended ? Math.round(remainingPercent - 100) : 0;
        const compactLabel = extended ? `+${extraPercent}%` : `${percent}%`;
        const title = extended
            ? `24h ${this.recentImageCount()} — Extended free usage (+${extraPercent}%, ${remainingPercent}% remaining, ${remainingText} left)`
            : `24h ${this.recentImageCount()} — V5 usage ${percent}% (${remainingText} left)`;
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
        if (window.optionsData) {
            window.optionsData.opusUsage = usage || null;
            if (usage && window.optionsData.user && window.optionsData.user.subscription) {
                window.optionsData.user.subscription.usage = usage;
            }
        }
        this.sync();
    }

    sync() {
        // one snapshot per ping: getSnapshot reads the Studio's controls (drain multiplier)
        const snap = this.getSnapshot();
        const genCount = document.getElementById('manualGenCountDisplay');
        // set*IfChanged: public/scripts/utils/domWrite.js (sync runs on every server ping)
        setAttrIfChanged(genCount, 'title', snap.title);
        const usageSplit = document.getElementById('manualGenUsageSplit');
        const usageEl = document.getElementById('manualGenUsagePercent');
        if (usageSplit) usageSplit.classList.toggle('hidden', !snap.isOpus);
        setTextIfChanged(usageEl, snap.isOpus ? snap.compactLabel : '');
        this.render(snap);
        this.updateExternalSurfaces(snap);
        this.notifyExtendedUsage({}, snap);
    }

    /**
     * One toast per session while remaining is over 100% (V5 launch +100% boost).
     * @param {{ forceDisplay?: boolean }} [options]
     */
    notifyExtendedUsage(options = {}, snap = this.getSnapshot()) {
        if (!snap.isOpus || !snap.usage) return;
        if (!snap.extended) {
            this.extendedUsageToastShown = false;
            return;
        }
        if (this.extendedUsageToastShown) return;
        // shouldDeferTrayNotifications, deferAccountTrayNotifications: public/scripts/comp/trayIndicators.js
        if (!options.forceDisplay && shouldDeferTrayNotifications()) {
            deferAccountTrayNotifications();
            return;
        }

        this.extendedUsageToastShown = true;
        showGlassToast(
            'success',
            'Extended Free Usage',
            `Opus V5 got a one-time +100% usage boost for launch, which can go past the normal 100% cap.<br/>You have <strong>${snap.remainingPercent}%</strong> remaining (${snap.remaining === 'Free' ? 'Free' : '~' + snap.remaining + ' free'} gens, +${snap.extraPercent}% extra). Refill stays paused until you drop below 100%.`,
            false,
            20000,
            '<i class="fas fa-battery-full"></i>',
            [{ text: 'Open', type: 'primary', closeOnClick: true, onClick: () => this.open() }]
        );
    }

    /**
     * Fill Anlas context-menu usage row (main menu). Call from menu loadfn.
     * @param {string} [suffix] - element id suffix ('' for the main menu)
     */
    fillAnlasMenuUsageRow(suffix = '', snap = null) {
        const row = document.getElementById(`contextAnlasOpusUsageRow${suffix}`);
        const valueEl = document.getElementById(`contextAnlasOpusUsage${suffix}`);
        const iconEl = document.getElementById(`contextAnlasOpusUsageIcon${suffix}`);
        if (!row || !valueEl) return;

        if (!snap) snap = this.getSnapshot();
        row.classList.toggle('hidden', !snap.isOpus);
        if (!snap.isOpus) return;

        valueEl.textContent = snap.remaining != null
            ? (snap.extended
                ? `Extended +${snap.extraPercent}% (${snap.remaining === 'Free' ? 'Free' : '~' + snap.remaining})`
                : `${snap.compactLabel} (${snap.remaining === 'Free' ? 'Free' : '~' + snap.remaining})`)
            : snap.compactLabel;
        row.title = snap.title;
        row.classList.toggle('low-credits', snap.high);
        setClassNameIfChanged(iconEl, snap.iconClass);
    }

    updateExternalSurfaces(snap = this.getSnapshot()) {
        this.fillDataMgmtAccountUsage(snap);
        this.fillAnlasMenuUsageRow('', snap);
        // walletTray.update: public/scripts/comp/walletTray.js (NovelAI V5 usage row)
        if (window.walletTray) window.walletTray.update();
    }

    fillDataMgmtAccountUsage(snap = null) {
        const host = document.getElementById('dataMgmtOpusUsageHost');
        if (!host) return;
        if (!snap) snap = this.getSnapshot();
        const valueEl = document.getElementById('dataMgmtOpusUsageValue');
        const fillEl = document.getElementById('dataMgmtOpusUsageFill');

        setClassIfChanged(host, 'hidden', !snap.isOpus);
        if (!snap.isOpus) return;

        if (valueEl) {
            setTextIfChanged(valueEl, snap.remaining != null
                ? (snap.extended
                    ? `Extended free +${snap.extraPercent}% (${snap.remaining === 'Free' ? 'Free' : '~' + snap.remaining} left)`
                    : `${snap.compactLabel} (${snap.remaining === 'Free' ? 'Free' : '~' + snap.remaining} left)`)
                : snap.compactLabel);
        }
        if (fillEl) {
            setStyleIfChanged(fillEl, 'width', snap.showBar ? `${Math.min(100, snap.barPercent)}%` : '0%');
            setClassIfChanged(fillEl, 'low', snap.high);
        }
    }

    /** "1 hour 41 minutes", "3 days 4 hours": the two largest units, as Vista words durations. */
    formatDuration(seconds) {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        if (total < 60) return 'less than a minute';
        const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
        const parts = [];
        let rest = total;
        for (const [name, size] of units) {
            const n = Math.floor(rest / size);
            if (n > 0 && parts.length < 2) {
                parts.push(`${n} ${name}${n === 1 ? '' : 's'}`);
                rest -= n * size;
            } else if (parts.length) {
                break;
            }
        }
        return parts.join(' ');
    }

    formatGens(value) {
        if (value === 'Free') return 'Free (this setup does not use the meter)';
        return Number.isFinite(value) ? `About ${value.toLocaleString()}` : '\u2014';
    }

    // The window: the meter (used share as Vista's progress bar, red when nearly empty) and the
    // readings. Only drawn while it is open; open() draws it first. The server pushes usage about
    // once a minute (percent left, isNegative, timeUntilNextPercent: seconds per 1% of refill).
    render(snap = null) {
        if (!this.element || this.element.classList.contains('hidden')) return;
        if (!snap) snap = this.getSnapshot();
        const byId = (id) => document.getElementById(id);
        const fillEl = byId('generationUsageFill');
        const barEl = byId('generationUsageBar');
        if (!fillEl || !barEl) return;
        const recentCount = this.recentImageCount();
        setTextIfChanged(byId('generationUsageDayCount'), recentCount.toLocaleString());

        const set = (id, text) => setTextIfChanged(byId(id), text);
        if (!snap.isOpus || !snap.usage) {
            set('generationUsageStatusLabel', 'Opus V5 usage');
            set('generationUsagePercent', snap.isOpus ? 'Usage is not available right now.' : 'Not metered');
            set('generationUsageMeterNote', snap.isOpus ? '' : 'The meter applies to Opus on V5.');
            for (const id of ['generationUsageRemaining', 'generationUsageRefill', 'generationUsageNext', 'generationUsageFull']) set(id, '\u2014');
            setStyleIfChanged(fillEl, 'width', '0%');
            setClassIfChanged(barEl, 'error', false);
            setAttrIfChanged(barEl, 'aria-valuenow', '0');
            return;
        }

        const usage = snap.usage;
        const left = Math.max(0, Math.round(snap.remainingPercent));
        set('generationUsageStatusLabel', snap.extended ? 'Opus V5 usage (extended)' : 'Opus V5 usage');
        set('generationUsagePercent', snap.extended
            ? `${left}% left (+${snap.extraPercent}% extra)`
            : `${snap.percent}% used`);
        set('generationUsageMeterNote', usage.isNegative ? 'Empty' : (snap.extended ? '' : `${left}% left`));
        setStyleIfChanged(fillEl, 'width', `${Math.min(100, snap.barPercent)}%`);
        setClassIfChanged(barEl, 'error', snap.high);
        setAttrIfChanged(barEl, 'aria-valuenow', String(Math.min(100, snap.barPercent)));

        set('generationUsageRemaining', usage.isNegative ? 'None (the meter is empty)' : this.formatGens(snap.remaining));
        const perPercent = Number(usage.timeUntilNextPercent);
        if (snap.refillPaused) {
            set('generationUsageRefill', snap.extended ? 'Paused while above 100%' : 'Paused');
            set('generationUsageNext', '\u2014');
            set('generationUsageFull', left >= 100 ? 'Full' : '\u2014');
        } else {
            const gens = snap.refillGenerations === 'Free' ? '' : ` (about ${snap.refillGenerations.toLocaleString()} images)`;
            set('generationUsageRefill', `${snap.refillPercent}% a day${gens}`);
            set('generationUsageNext', perPercent > 0 ? this.formatDuration(perPercent) : '\u2014');
            set('generationUsageFull', perPercent > 0 ? `About ${this.formatDuration(perPercent * Math.max(1, 100 - left))}` : '\u2014');
        }
    }

    open() {
        if (!this.element) return;
        openModal(this.element);
        bringModalToFront(this.element);
        // render skips a hidden window, so it draws once the window is shown
        this.render();
    }
}

const usageToolManager = new GenerationUsageToolManager();

wsClient.registerInitStep(36, 'Initializing generation usage tool', async () => {
    usageToolManager.init();
});
