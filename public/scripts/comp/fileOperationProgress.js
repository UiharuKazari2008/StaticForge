/**
 * Vista's file operation progress dialog: "Copying 3 items (1.20 MB)", the teal banner with its
 * movie, from / to, the time left, the progress bar, More information and Cancel. Explorer
 * (explorerApplet.js) runs its moves, copies, uploads, deletes and Trash moves through it.
 *
 * Taken from the Vista VM (SHFileOperation / IFileOperation, Aero, 96 dpi):
 *   - layout: shell32.dll UIFILE 42 (DirectUI sheet "ProgressDialog"), measured pixel for pixel
 *     in public/css/vista-file-progress.css
 *   - words: shell32.dll.mui string tables 849/850 (from, to, Time remaining:, More information)
 *     and 2055-2060 (Copying / Moving / Deleting / Recycling, "%1 items (%2)", "About %1",
 *     "%1 remaining", "%1/sec", "%1 Minutes and %2 Seconds" ...)
 *   - timing: Vista holds the dialog back ~1 s and never shows it for a shorter operation; here it
 *     comes up as the operation starts (our requests' length is not known ahead) and stays at least
 *     MIN_VISIBLE_MS, and the caption turns from the banner text into "N Seconds remaining" ~1 s in
 *   - an item that fails asks as Vista's Interrupted Action does: Try Again, Skip or Cancel
 *   - the banner movie is not stored anywhere in shell32 (DirectUI draws it in code): each
 *     operation's own loop was recorded from the screen at 20 ms, the header text unmixed out,
 *     and the frames are /static_images/vista-file-progress/movie-<op>.webp (400x40 strips)
 *     with the time each frame came up, below. Copy, Move, Delete and Recycle each have their
 *     own movie; an upload is a copy into the folder, as Vista shows a drop from the disk.
 *
 * API (window.fileOperationProgress):
 *   const op = begin({ op, items: [{ name, size }], from: { name, path }, to: { name, path } })
 *   op.next() / op.done(item)       around each item; op.cancelled once Cancel was pressed
 *   op.doneAll(items)               a batch done at once (one request for several items)
 *   op.attempt(item, fn)            await fn(); a failure asks Try Again / Skip / Cancel; resolves
 *                                   { ok, value }. Without the dialog the failure throws as before.
 *   op.setPlace('from' | 'to', p)   a better name for a location (the server's, once it answers)
 *   op.finish()                     closes the dialog
 *   op.shown                        true when the dialog is up (the desktop); callers that toast
 *                                   without it stay quiet with it
 *   available()                     whether operations get the dialog (the desktop)
 *   run(options, items, worker)     begin + attempt(worker(item, index)) per item, stopping at Cancel;
 *                                   resolves { done, cancelled, shown, values }
 *   batches(options, items, worker) the same for an API that takes a list: worker(chunk) for up to
 *                                   BATCHES chunks, so the bar moves and Cancel stops between them
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-file-progress/';
    // shown at once, kept up at least this long so an operation that ends quickly is still seen
    const MIN_VISIBLE_MS = 600;
    const ESTIMATE_DELAY_MS = 1000;
    const ESTIMATE_EVERY_MS = 1000;
    // More information: the open part fades out over this while the window grows (the other then
    // fades in, vista-file-progress.css)
    const EXPAND_FADE_MS = 300;
    const FRAME_HEIGHT = 40;
    const BATCHES = 20;

    const VERBS = { copy: 'Copying', move: 'Moving', delete: 'Deleting', recycle: 'Recycling' };
    // Interrupted Action: "An unexpected error is keeping you from copying the file."
    const ERROR_VERBS = { copy: 'copying', move: 'moving', delete: 'deleting', recycle: 'deleting' };
    // when each recorded frame came up (ms into the loop) and the loop's length
    const MOVIES = {
        copy: {
            period: 3195,
            times: [0, 167, 224, 343, 366, 423, 463, 523, 563, 603, 661, 700, 759, 799, 837, 933, 972, 1050, 1090, 1188, 1228, 1309, 1347, 1424, 1463, 1522, 1581, 1619, 1678, 1717, 1756, 1815, 1855, 1894, 1953, 1992, 2050, 2089, 2129, 2187, 2227, 2286, 2325, 2364, 2425, 2464, 2503, 2561, 2601, 2641, 2700, 2740, 2780, 2821, 2921, 2960, 3037, 3077]
        },
        move: {
            period: 4050,
            times: [0, 40, 99, 139, 179, 239, 278, 318, 378, 418, 458, 517, 557, 596, 656, 696, 755, 795, 834, 894, 934, 974, 1033, 1072, 1111, 1171, 1211, 1271, 1310, 1350, 1409, 1449, 1489, 1549, 1589, 1628, 1688, 1727, 1766, 1824, 1863, 1923, 1962, 2002, 2061, 2101, 2141, 2199, 2240, 2278, 2318, 2358, 2416, 2456, 2496, 2555, 2595, 2635, 2695, 2735, 2775, 2835, 2875, 2915, 2975, 3015, 3055, 3115, 3155, 3214, 3254, 3294, 3354, 3394, 3434, 3494, 3533, 3573, 3633, 3672, 3712, 3772, 3812, 3852, 3912, 3950, 3990]
        },
        delete: {
            period: 4120,
            times: [0, 59, 98, 158, 196, 256, 296, 336, 395, 435, 475, 535, 574, 614, 673, 713, 752, 810, 850, 909, 948, 1044, 1124, 1145, 1185, 1224, 1284, 1323, 1363, 1421, 1461, 1520, 1560, 1599, 1658, 1696, 1736, 1796, 1836, 1895, 1934, 1992, 2031, 2071, 2110, 2169, 2208, 2267, 2307, 2347, 2405, 2444, 2502, 2542, 2581, 2639, 2677, 2736, 2795, 2815, 2874, 2914, 2953, 3012, 3052, 3171, 3190, 3249, 3288, 3326, 3385, 3424, 3484, 3522, 3562, 3621, 3660, 3718, 3758, 3798, 3858, 3897, 3937, 3995, 4034, 4092]
        },
        recycle: {
            period: 4096,
            times: [0, 38, 96, 134, 192, 268, 325, 365, 423, 461, 518, 556, 594, 651, 690, 748, 786, 843, 881, 939, 977, 1016, 1074, 1112, 1170, 1208, 1266, 1305, 1363, 1402, 1441, 1500, 1538, 1596, 1634, 1692, 1732, 1770, 1827, 1865, 1905, 1962, 2000, 2057, 2096, 2154, 2174, 2212, 2270, 2308, 2365, 2404, 2462, 2502, 2560, 2598, 2637, 2694, 2732, 2789, 2827, 2886, 2926, 2966, 3023, 3061, 3099, 3157, 3196, 3254, 3292, 3349, 3387, 3445, 3484, 3522, 3579, 3618, 3675, 3715, 3754, 3811, 3868, 3906, 3944, 4001, 4039]
        }
    };

    const TEXT = {
        from: 'from',
        to: ' to ',
        fromLabel: 'From:',
        toLabel: 'To:',
        timeLabel: 'Time remaining:',
        itemsLabel: 'Items remaining:',
        speedLabel: 'Speed:',
        calculating: 'Calculating...',
        calculatingTime: 'Calculating time remaining...',
        canceling: 'Canceling...',
        more: 'More information',
        less: 'Less information',
        cancel: 'Cancel',
        interrupted: 'Interrupted Action',
        tryAgain: 'Try Again',
        skip: 'Skip'
    };

    let dialogSeq = 0;

    function el(tag, className, text) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function count(n) {
        return Math.max(0, Math.round(n)).toLocaleString('en-US');
    }

    /** StrFormatByteSize as Vista prints it: three significant digits, truncated ("76.2 MB" for 76.29). */
    function formatBytes(bytes) {
        const n = Math.max(0, Math.floor(Number(bytes) || 0));
        if (n < 1024) return `${n} bytes`;
        const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
        let v = n / 1024;
        let u = 0;
        while (v >= 1000 && u < units.length - 1) {
            v /= 1024;
            u += 1;
        }
        const decimals = v >= 100 ? 0 : (v >= 10 ? 1 : 2);
        const f = Math.pow(10, decimals);
        return `${(Math.floor(v * f) / f).toFixed(decimals)} ${units[u]}`;
    }

    /** "3 items (1.20 MB)"; items whose size is not known (gallery images, shortcuts) leave it out. */
    function itemsText(n, bytes, sized) {
        const items = `${count(n)} ${n === 1 ? 'item' : 'items'}`;
        return sized ? `${items} (${formatBytes(bytes)})` : items;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function plural(n, one, many) {
        return `${n} ${n === 1 ? one : many}`;
    }

    /** "10 Seconds", "1 Minute and 5 Seconds", "2 Hours and 1 Minute": seconds in steps of 5. */
    function formatDuration(seconds) {
        let s = Math.max(0, Math.round(seconds / 5) * 5);
        if (s < 60) return plural(s, 'Second', 'Seconds');
        const days = Math.floor(s / 86400);
        const hours = Math.floor(s / 3600) % 24;
        const minutes = Math.floor(s / 60) % 60;
        s %= 60;
        if (days) return `${plural(days, 'Day', 'Days')} and ${plural(hours, 'hour', 'hours')}`;
        if (hours) return `${plural(hours, 'Hour', 'Hours')} and ${plural(minutes, 'Minute', 'Minutes')}`;
        return `${plural(minutes, 'Minute', 'Minutes')} and ${plural(s, 'Second', 'Seconds')}`;
    }

    function isDesktop() {
        return !!doc && !!doc.body && doc.body.classList.contains('desktop-mode');
    }

    function captionButton(className, title, iconClass, disabled) {
        const b = el('button', className);
        b.type = 'button';
        b.title = title;
        if (disabled) b.disabled = true;
        const i = el('i', iconClass);
        i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        return b;
    }

    /** "<b>name</b> (path)", the shell's location display; a long path gives way at its start (the
     *  folder's own end stays, as DirectUI's path ellipsis keeps it), the marks keep it left to right. */
    function location(place) {
        const span = el('span', 'file-progress-location');
        span.appendChild(el('b', '', place.name || ''));
        if (place.path) {
            span.appendChild(el('span', '', ' ('));
            span.appendChild(el('span', 'file-progress-path', `\u200e${place.path}\u200e`));
            span.appendChild(el('span', '', ')'));
        }
        return span;
    }

    class Operation {
        constructor(options) {
            this.op = MOVIES[options.op] ? options.op : 'copy';
            this.from = options.from && options.from.name ? options.from : null;
            this.to = options.to && options.to.name ? options.to : null;
            this.items = (options.items || []).map((i) => ({ name: i && i.name, size: Math.max(0, Number(i && i.size) || 0) }));
            this.totalItems = this.items.length;
            this.totalBytes = this.items.reduce((sum, i) => sum + i.size, 0);
            this.sized = this.totalBytes > 0;
            this.doneItems = 0;
            this.doneBytes = 0;
            this.cancelled = false;
            this.finished = false;
            this.expanded = false;
            this.started = Date.now();
            this.estimate = null;
            this.modal = null;
            this.raf = 0;
            this.shownAt = 0;
            if (this.totalItems > 0) this.show();
        }

        get headerText() {
            return `${VERBS[this.op]} ${itemsText(this.totalItems, this.totalBytes, this.sized)}`;
        }

        get shown() {
            return !!this.modal;
        }

        /** Before each item: false once Cancel was pressed. */
        next() {
            return !this.cancelled;
        }

        done(item) {
            this.doneAll([item]);
        }

        doneAll(items) {
            for (const item of items || []) {
                this.doneItems = Math.min(this.totalItems, this.doneItems + 1);
                this.doneBytes = Math.min(this.totalBytes, this.doneBytes + Math.max(0, Number(item && item.size) || 0));
            }
            this.render();
        }

        /**
         * await fn() for an item (or a batch); a failure asks Vista's Interrupted Action: Try Again
         * runs it again, Skip goes on to the next, Cancel stops the operation. Resolves { ok, value }.
         * Without the dialog (not the desktop) the failure throws, for the caller's own message.
         */
        async attempt(item, fn) {
            for (;;) {
                try {
                    return { ok: true, value: await fn() };
                } catch (err) {
                    if (!this.modal) throw err;
                    console.error('File operation:', err);
                    const answer = await this.interrupted(item, err);
                    if (answer === 'retry') continue;
                    if (answer !== 'skip') this.cancel();
                    return { ok: false, error: err };
                }
            }
        }

        /** "An unexpected error is keeping you from copying the file." with the error and the item. */
        async interrupted(item, err) {
            const names = (Array.isArray(item) ? item : [item]).map((i) => i && i.name).filter(Boolean);
            const what = names.length > 1 ? 'files' : 'file';
            const message = `<p>An unexpected error is keeping you from ${ERROR_VERBS[this.op]} the ${what}. `
                + 'If you continue to receive this error, you can use the error code to search for help with this problem.</p>'
                + `<p>${escapeHtml((err && err.message) || String(err || 'Unknown error'))}</p>`
                + (names.length ? `<p><b>${escapeHtml(names.slice(0, 3).join(', '))}${names.length > 3 ? ', ...' : ''}</b></p>` : '');
            // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
            if (typeof root.showConfirmationDialog !== 'function') return 'cancel';
            const answer = await root.showConfirmationDialog(message, [
                { text: TEXT.tryAgain, value: 'retry', className: 'btn-primary' },
                { text: TEXT.skip, value: 'skip', className: 'btn-secondary' },
                { text: TEXT.cancel, value: 'cancel', className: 'btn-secondary' }
            ], null, { title: TEXT.interrupted, icon: 'fas fa-exclamation-triangle' });
            return answer || 'cancel';
        }

        cancel() {
            if (this.cancelled || this.finished) return;
            this.cancelled = true;
            if (!this.modal) return;
            this.cancelButton.disabled = true;
            this.timeLine.textContent = TEXT.canceling;
            this.timeValue.textContent = TEXT.canceling;
        }

        finish() {
            if (this.finished) return;
            this.finished = true;
            if (this.modal && !this.cancelled) {
                // the bar full, and the dialog up long enough to be seen
                this.doneItems = this.totalItems;
                this.doneBytes = this.totalBytes;
                this.render();
                const left = MIN_VISIBLE_MS - (Date.now() - this.shownAt);
                if (left > 0) {
                    setTimeout(() => this.close(), left);
                    return;
                }
            }
            this.close();
        }

        close() {
            clearTimeout(this.tickTimer);
            clearTimeout(this.swapTimer);
            if (this.raf) cancelAnimationFrame(this.raf);
            this.raf = 0;
            const modal = this.modal;
            this.modal = null;
            if (!modal) return;
            Promise.resolve().then(() => {
                // closeModal: public/scripts/comp/modalUtils.js
                if (typeof root.closeModal === 'function') return root.closeModal(modal);
                return null;
            }).catch(() => {}).then(() => {
                if (modal.parentNode) modal.parentNode.removeChild(modal);
            });
        }

        /** A better name for the source or destination (the server's, once it answers). */
        setPlace(which, place) {
            if (!place || !place.name || (which !== 'from' && which !== 'to') || !this[which]) return;
            this[which] = place;
            if (!this.placeEls) return;
            this.placeEls[which] = this.placeEls[which].map((old) => {
                const node = location(place);
                old.replaceWith(node);
                return node;
            });
        }

        /** The fraction done: by bytes when the items have sizes, by items otherwise. */
        fraction() {
            if (this.totalBytes > 0) return this.doneBytes / this.totalBytes;
            return this.totalItems ? this.doneItems / this.totalItems : 1;
        }

        updateEstimate() {
            const elapsed = (Date.now() - this.started) / 1000;
            const f = this.fraction();
            if (elapsed <= 0 || f <= 0) {
                this.estimate = null;
                return;
            }
            this.estimate = {
                seconds: elapsed * (1 - f) / f,
                speed: this.doneBytes / elapsed
            };
        }

        build() {
            const modal = el('div', 'modal hidden file-progress-dialog');
            modal.id = 'fileProgressDialog' + (++dialogSeq);
            modal.dataset.windowIdentifier = 'fileProgressDialog';
            modal.dataset.windowRestorePosition = 'false';
            modal.dataset.windowRestoreSize = 'false';
            modal.dataset.windowFixedSize = 'true';
            // vista-dialogs.css: the light client, the push buttons and the default button's pulse
            modal.dataset.vistaDialog = 'task';
            modal.dataset.windowClient = 'light';
            modal.dataset.fileOp = this.op;
            modal.setAttribute('role', 'dialog');

            const title = el('div', 'modal-window-title');
            const main = el('div', 'modal-window-title-main');
            const img = el('img', 'icon-image');
            img.alt = '';
            img.src = ART + 'progress-16.png';
            img.srcset = `${ART}progress-16.png 1x, ${ART}progress-32.png 2x`;
            this.captionText = el('span', '', this.headerText);
            main.append(img, this.captionText);
            title.appendChild(main);

            const controls = el('div', 'modal-window-controls');
            const closeBtn = captionButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
            controls.append(
                captionButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize'),
                captionButton('btn-secondary btn-small file-progress-maximize', 'Maximize', 'fa-regular fa-window-maximize', true),
                closeBtn
            );

            const content = el('div', 'modal-content win7 file-progress-content');

            const header = el('div', 'file-progress-header');
            this.movie = el('div', 'file-progress-movie');
            this.movie.style.backgroundImage = `url("${ART}movie-${this.op}.webp")`;
            this.movie.setAttribute('aria-hidden', 'true');
            this.headerLabel = el('div', 'file-progress-header-text', this.headerText);
            header.append(this.movie, this.headerLabel);

            const body = el('div', 'file-progress-body');
            const summary = el('div', 'file-progress-summary file-progress-shown');
            const places = el('div', 'file-progress-line file-progress-locations');
            this.placeEls = { from: [], to: [] };
            const place = (which) => {
                const node = location(this[which]);
                this.placeEls[which].push(node);
                return node;
            };
            if (this.from) places.append(TEXT.from + ' ', place('from'));
            if (this.to) places.append(this.from ? TEXT.to : 'to ', place('to'));
            this.timeLine = el('div', 'file-progress-line file-progress-time', TEXT.calculatingTime);
            summary.append(places, this.timeLine);

            const details = el('div', 'file-progress-details');
            const row = (label, value) => {
                details.append(el('div', 'file-progress-label', label), value);
                return value;
            };
            if (this.from) row(TEXT.fromLabel, el('div', 'file-progress-value')).appendChild(place('from'));
            if (this.to) row(TEXT.toLabel, el('div', 'file-progress-value')).appendChild(place('to'));
            this.timeValue = row(TEXT.timeLabel, el('div', 'file-progress-value', TEXT.calculating));
            this.itemsValue = row(TEXT.itemsLabel, el('div', 'file-progress-value'));
            this.speedValue = row(TEXT.speedLabel, el('div', 'file-progress-value', TEXT.calculating));
            body.append(summary, details);
            this.summary = summary;
            this.details = details;
            this.body = body;
            this.detailRows = details.children.length / 2;

            const barRow = el('div', 'file-progress-bar-row');
            this.bar = el('div', 'file-progress-bar animate');
            this.bar.setAttribute('role', 'progressbar');
            this.bar.setAttribute('aria-valuemin', '0');
            this.bar.setAttribute('aria-valuemax', '100');
            this.barFill = el('div');
            this.bar.appendChild(this.barFill);
            barRow.appendChild(this.bar);

            const footer = el('div', 'vista-dialog-footer file-progress-footer');
            this.expando = el('button', 'file-progress-expando');
            this.expando.type = 'button';
            this.expandoText = el('span', 'file-progress-expando-text', TEXT.more);
            this.expando.append(el('span', 'file-progress-expando-image'), this.expandoText);
            this.expando.setAttribute('aria-expanded', 'false');
            this.cancelButton = el('button', 'btn-secondary file-progress-cancel', TEXT.cancel);
            this.cancelButton.type = 'button';
            this.cancelButton.dataset.dialogPrimary = '1';
            footer.append(this.expando, this.cancelButton);

            content.append(header, body, barRow, footer);
            modal.append(title, el('div', 'modal-focus-overlay'), controls, content);
            doc.body.appendChild(modal);

            this.expando.addEventListener('click', () => this.toggleDetails());
            this.cancelButton.addEventListener('click', () => this.cancel());
            closeBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.cancel();
            }, true);
            modal.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    this.cancel();
                }
            });
            this.modal = modal;
            return modal;
        }

        show() {
            if (this.finished || this.modal || !isDesktop()) return;
            this.shownAt = Date.now();
            this.build();
            this.render();
            try {
                // openModal: public/scripts/comp/modalUtils.js
                if (typeof root.openModal !== 'function') throw new Error('no window manager');
                root.openModal(this.modal);
            } catch (err) {
                console.error('File progress dialog:', err);
                this.modal.classList.remove('hidden');
            }
            this.playMovie();
            setTimeout(() => {
                if (this.modal && !this.cancelled) {
                    try { this.cancelButton.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
                }
            }, 0);
            // the first estimate, then a fresh one every second (the caption follows it)
            const tick = () => {
                if (!this.modal) return;
                this.updateEstimate();
                this.render();
                this.tickTimer = setTimeout(tick, ESTIMATE_EVERY_MS);
            };
            this.tickTimer = setTimeout(tick, ESTIMATE_DELAY_MS);
        }

        playMovie() {
            const movie = MOVIES[this.op];
            const t0 = performance.now();
            let shown = -1;
            const step = (now) => {
                if (!this.modal) return;
                const t = (now - t0) % movie.period;
                let lo = 0;
                let hi = movie.times.length - 1;
                while (lo < hi) {
                    const mid = (lo + hi + 1) >> 1;
                    if (movie.times[mid] <= t) lo = mid; else hi = mid - 1;
                }
                if (lo !== shown) {
                    shown = lo;
                    this.movie.style.backgroundPositionY = `${-lo * FRAME_HEIGHT}px`;
                }
                this.raf = requestAnimationFrame(step);
            };
            this.raf = requestAnimationFrame(step);
        }

        render() {
            if (!this.modal) return;
            const pct = Math.max(0, Math.min(100, this.fraction() * 100));
            this.barFill.style.width = `${pct}%`;
            this.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
            this.itemsValue.textContent = `${count(this.totalItems - this.doneItems)} (${formatBytes(this.totalBytes - this.doneBytes)})`;
            if (this.cancelled) return;
            if (this.estimate) {
                const left = formatDuration(this.estimate.seconds);
                this.captionText.textContent = `${left} remaining`;
                this.timeLine.textContent = `About ${left} remaining`;
                this.timeValue.textContent = `About ${left}`;
                this.speedValue.textContent = `${formatBytes(this.estimate.speed)}/sec`;
            }
        }

        /** More / Less information: the open part fades out while the window grows, then the other fades in. */
        toggleDetails() {
            if (!this.modal) return;
            this.expanded = !this.expanded;
            const expanded = this.expanded;
            this.expando.setAttribute('aria-expanded', String(expanded));
            this.expandoText.textContent = expanded ? TEXT.less : TEXT.more;
            this.modal.classList.toggle('file-progress-expanded', expanded);
            const outgoing = expanded ? this.summary : this.details;
            const incoming = expanded ? this.details : this.summary;
            const lines = expanded ? this.detailRows : 2;
            clearTimeout(this.swapTimer);
            outgoing.classList.add('file-progress-fading');
            incoming.classList.remove('file-progress-shown');
            this.body.style.height = `${lines * 15}px`;
            this.swapTimer = setTimeout(() => {
                outgoing.classList.remove('file-progress-shown', 'file-progress-fading');
                incoming.classList.add('file-progress-shown');
            }, EXPAND_FADE_MS);
        }
    }

    function begin(options) {
        return new Operation(options || {});
    }

    function available() {
        return isDesktop();
    }

    function described(options, list) {
        return Object.assign({}, options, {
            items: options.items || list.map((i) => ({ name: i && i.name, size: i && i.size }))
        });
    }

    /**
     * worker(item, index, op) for each item in turn with the dialog up, a failure asking Try Again /
     * Skip / Cancel; stops at Cancel. Resolves { done, cancelled, shown, values } (values: what each
     * worker that went through returned). Without the dialog a failure throws.
     */
    async function run(options, items, worker) {
        const list = Array.from(items || []);
        const op = begin(described(options || {}, list));
        const shown = op.shown;
        const values = [];
        let done = 0;
        try {
            for (let i = 0; i < list.length; i++) {
                if (!op.next()) break;
                const r = await op.attempt(list[i], () => worker(list[i], i, op));
                if (r.ok) {
                    done += 1;
                    values.push(r.value);
                }
                op.done(list[i]);
            }
        } finally {
            op.finish();
        }
        return { done, cancelled: op.cancelled, shown, values };
    }

    /**
     * run() for an API that takes a list (deleteImagesBulk, moveFilesToWorkspace ...): worker(chunk,
     * op) for up to BATCHES chunks in turn, so the bar moves and Cancel stops between them. Without
     * the dialog it is one call with the whole list. `options.items` describes the list for the
     * dialog when the list itself is plain names. Resolves as run(), done counting items.
     */
    async function batches(options, items, worker) {
        const list = Array.from(items || []);
        const opts = described(options || {}, list);
        if (!available()) {
            const value = list.length ? await worker(list, null) : undefined;
            return { done: list.length, cancelled: false, shown: false, values: list.length ? [value] : [] };
        }
        const op = begin(opts);
        const shown = op.shown;
        const size = Math.max(1, Math.ceil(list.length / BATCHES));
        const values = [];
        let done = 0;
        try {
            for (let i = 0; i < list.length; i += size) {
                if (!op.next()) break;
                const chunk = list.slice(i, i + size);
                const info = op.items.slice(i, i + size);
                const r = await op.attempt(info, () => worker(chunk, op));
                if (r.ok) {
                    done += chunk.length;
                    values.push(r.value);
                }
                op.doneAll(info);
            }
        } finally {
            op.finish();
        }
        return { done, cancelled: op.cancelled, shown, values };
    }

    const api = { begin, run, batches, available, formatBytes, formatDuration, MOVIES, MIN_VISIBLE_MS };
    if (root) root.fileOperationProgress = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
