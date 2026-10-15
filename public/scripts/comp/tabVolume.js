/**
 * Tab volume. One slider for every sound in this tab (media elements and
 * Web Audio), saved on this computer. The tray icon sits left of the network
 * icon. The popup is Vista's volume flyout (SndVolSSO on the VM): vertical
 * slider, speaker button, Mixer footer.
 *
 * localStorage desktop-tab-volume (0-100) and desktop-tab-muted (`1`).
 */
(function () {
    const VOLUME_KEY = 'desktop-tab-volume';
    const MUTE_KEY = 'desktop-tab-muted';

    let level = 100;
    let muted = false;
    let flyout = null;

    function masterGain() {
        if (muted || level <= 0) return 0;
        return level / 100;
    }

    function readStored() {
        try {
            const raw = localStorage.getItem(VOLUME_KEY);
            if (raw != null && raw !== '') {
                const n = Number(raw);
                if (Number.isFinite(n)) level = Math.max(0, Math.min(100, Math.round(n)));
            }
            muted = localStorage.getItem(MUTE_KEY) === '1';
        } catch (_err) {
            level = 100;
            muted = false;
        }
    }

    function writeStored() {
        try {
            localStorage.setItem(VOLUME_KEY, String(level));
            if (muted) localStorage.setItem(MUTE_KEY, '1');
            else localStorage.removeItem(MUTE_KEY);
        } catch (_err) {
            // Private mode: the slider still works for this visit.
        }
    }

    const mediaLevels = typeof WeakMap === 'function' ? new WeakMap() : null;
    const volDesc = typeof HTMLMediaElement === 'function'
        ? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')
        : null;

    if (volDesc && mediaLevels && volDesc.get && volDesc.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
            configurable: true,
            enumerable: volDesc.enumerable,
            get() {
                return mediaLevels.has(this) ? mediaLevels.get(this) : volDesc.get.call(this);
            },
            set(v) {
                const logical = Math.max(0, Math.min(1, Number(v) || 0));
                mediaLevels.set(this, logical);
                volDesc.set.call(this, logical * masterGain());
            }
        });
    }

    const masters = [];
    const contexts = typeof WeakMap === 'function' ? new WeakMap() : null;
    const origConnect = typeof AudioNode === 'function' ? AudioNode.prototype.connect : null;

    function masterFor(ctx) {
        let node = contexts.get(ctx);
        if (node) return node;
        node = ctx.createGain();
        node.gain.value = masterGain();
        contexts.set(ctx, node);
        masters.push(node);
        origConnect.call(node, ctx.destination);
        return node;
    }

    if (origConnect && contexts) {
        AudioNode.prototype.connect = function (dest) {
            if (dest && dest.context && dest === dest.context.destination) {
                const args = Array.prototype.slice.call(arguments);
                args[0] = masterFor(dest.context);
                return origConnect.apply(this, args);
            }
            return origConnect.apply(this, arguments);
        };
    }

    function applyMaster() {
        const gain = masterGain();
        masters.forEach((node) => {
            node.gain.value = gain;
        });
        if (!volDesc || !mediaLevels) return;
        document.querySelectorAll('audio, video').forEach((el) => {
            const logical = mediaLevels.has(el) ? mediaLevels.get(el) : volDesc.get.call(el);
            mediaLevels.set(el, logical);
            volDesc.set.call(el, logical * gain);
        });
    }

    function iconLevel() {
        if (muted || level <= 0) return 'mute';
        if (level < 34) return 'low';
        if (level < 67) return 'mid';
        return 'high';
    }

    function paintIcon() {
        const icon = document.getElementById('volumeTrayIcon');
        if (!icon) return;
        icon.dataset.level = iconLevel();
        icon.title = muted || level <= 0 ? 'Volume: Muted' : 'Volume: ' + level + '%';
        const glyph = icon.querySelector('i');
        if (glyph) {
            const fa = iconLevel() === 'mute' ? 'fa-volume-xmark'
                : iconLevel() === 'low' ? 'fa-volume-off'
                : iconLevel() === 'mid' ? 'fa-volume-low'
                : 'fa-volume-high';
            glyph.className = 'fas ' + fa;
        }
    }

    function paintFlyout() {
        if (!flyout) return;
        flyout.classList.toggle('is-muted', muted || level <= 0);
        const range = flyout.querySelector('.volume-flyout-range');
        if (range) range.value = String(muted ? 0 : level);
        const muteBtn = flyout.querySelector('.volume-flyout-mute');
        if (muteBtn) muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    }

    function setLevel(next, opts) {
        level = Math.max(0, Math.min(100, Math.round(next)));
        if (!opts || !opts.keepMute) muted = level <= 0 ? muted : false;
        if (level <= 0) muted = true;
        writeStored();
        applyMaster();
        paintIcon();
        paintFlyout();
    }

    function setMuted(next) {
        muted = !!next;
        if (!muted && level <= 0) level = 50;
        writeStored();
        applyMaster();
        paintIcon();
        paintFlyout();
    }

    function ensureFlyout() {
        if (flyout) return flyout;
        flyout = document.createElement('div');
        flyout.id = 'volumeFlyout';
        flyout.className = 'volume-flyout hidden';
        flyout.innerHTML = ''
            + '<div class="volume-flyout-slider win7">'
            + '<div class="is-vertical">'
            + '<input type="range" class="volume-flyout-range" min="0" max="100" step="1" aria-label="Volume">'
            + '</div>'
            + '</div>'
            + '<button type="button" class="volume-flyout-mute" aria-label="Mute"></button>'
            + '<div class="volume-flyout-mixer">Mixer</div>';
        document.body.appendChild(flyout);

        const range = flyout.querySelector('.volume-flyout-range');
        range.addEventListener('input', () => {
            setLevel(Number(range.value));
        });
        range.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                e.preventDefault();
                setLevel(level + 5);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                e.preventDefault();
                setLevel(level - 5);
            }
        });

        flyout.querySelector('.volume-flyout-mute').addEventListener('click', (e) => {
            e.stopPropagation();
            setMuted(!muted);
        });

        document.addEventListener('pointerdown', (e) => {
            if (!flyout || flyout.classList.contains('hidden')) return;
            if (flyout.contains(e.target)) return;
            const icon = document.getElementById('volumeTrayIcon');
            if (icon && icon.contains(e.target)) return;
            hideFlyout();
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideFlyout();
        });
        return flyout;
    }

    function positionFlyout() {
        const icon = document.getElementById('volumeTrayIcon');
        if (!flyout || !icon) return;
        const rect = icon.getBoundingClientRect();
        const width = flyout.offsetWidth || 74;
        const margin = 8;
        let left = rect.right - width;
        if (left < margin) left = margin;
        if (left + width > innerWidth - margin) left = innerWidth - width - margin;
        flyout.style.left = left + 'px';
        flyout.style.bottom = Math.max(margin, innerHeight - rect.top + 4) + 'px';
    }

    function showFlyout() {
        ensureFlyout();
        flyout.classList.remove('hidden');
        paintFlyout();
        positionFlyout();
    }

    function hideFlyout() {
        if (flyout) flyout.classList.add('hidden');
    }

    function toggleFlyout() {
        if (flyout && !flyout.classList.contains('hidden')) hideFlyout();
        else showFlyout();
    }

    function wireIcon() {
        const icon = document.getElementById('volumeTrayIcon');
        if (!icon || icon.dataset.volumeWired === '1') return;
        icon.dataset.volumeWired = '1';
        icon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFlyout();
        });
        paintIcon();
    }

    readStored();
    writeStored();
    applyMaster();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireIcon);
    } else {
        wireIcon();
    }
})();
