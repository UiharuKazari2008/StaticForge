/**
 * Glancewell's video playback: Windows Photo Gallery's viewer for a video (Yozora #446; PhotoViewer.dll, checked on the
 * Vista VM with Bear.wmv, Nov 20 2026).
 *
 *   the video     fitted in the viewer, up and down (the renderer stretches it as Photo Gallery does): 13 px from the
 *                 top and sides, 44 px from the bottom, where the seek bar is; it plays as soon as it is shown
 *   the pill      Play Video (H) / Pause Video (K) and Stop Video (Home) take the zoom and Actual Size places
 *                 (PhotoViewer.dll PNG 4130 / 4133 / 4136, disabled / normal / hot / pressed); rotation and Fix
 *                 stay off ("Video files can't be edited using Photo Gallery"), and so does Print
 *   the seek bar  835 x 5 in the VM's 878 px stage: 20 px in from the left, 23 from the right, 18 px up from the
 *                 bottom; a #717171 top line, #e6e6e6 face (none in its last 6 px), #d2d2d2 bottom row, #838383
 *                 right end; the 20 x 8 blue thumb rides along it; click or drag to seek
 *   Info          "3.85 MB (00:00:12)": the length once the video has told it (phone entries carry it already)
 *
 * Only the shown video has a source: the next and previous slides make no requests, and a video left behind lets go
 * of its connection (an ActiveSync device answers one file at a time per slot).
 *
 *   window.glancewellVideo = {
 *     padding(itemData) -> PhotoSwipe padding, attach(pswp), sync(pswp), isVideo(itemData)
 *   }
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const PAD = { top: 13, bottom: 44, left: 13, right: 13 };
    const NONE = { top: 0, bottom: 0, left: 0, right: 0 };
    // the slide's own size: the aspect at a size the window never reaches, so the fit always fills it
    const TALL = 10000;
    const THUMB_W = 20;

    const S = {
        pswp: null,
        content: null,
        video: null,
        bar: null,
        thumb: null,
        play: null,
        stop: null,
        dragging: false,
        listeners: null
    };

    const isVideo = (data) => !!data && data.type === 'video';

    function padding(data) {
        return isVideo(data) ? PAD : NONE;
    }

    /** The slide size for an aspect (width / height). */
    function sizeFor(aspect) {
        const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 4 / 3;
        return { width: Math.round(TALL * a), height: TALL };
    }

    function shell() {
        return doc.getElementById('photoSwipeWindow');
    }

    // ---- the pill and the seek bar ----

    function ensureChrome(sh) {
        const pill = sh && sh.querySelector('.wpg-pill');
        if (!pill) return false;
        if (!S.play || !S.play.isConnected) {
            const make = (cls, gw, title) => {
                const b = doc.createElement('button');
                b.type = 'button';
                b.className = `wpg-ctl ${cls}`;
                b.dataset.gwVideo = gw;
                b.title = title;
                b.hidden = true;
                pill.insertBefore(b, pill.querySelector('.wpg-prev'));
                return b;
            };
            S.play = make('wpg-vplay', 'play', 'Play Video (H)');
            S.stop = make('wpg-vstop', 'stop', 'Stop Video (Home)');
            S.play.addEventListener('click', (e) => { e.preventDefault(); togglePlay(); });
            S.stop.addEventListener('click', (e) => { e.preventDefault(); stopVideo(); });
        }
        return true;
    }

    function ensureSeekBar(p) {
        if (S.bar && S.bar.parentNode === p.element) return;
        const bar = doc.createElement('div');
        bar.className = 'wpg-seek';
        bar.hidden = true;
        const thumb = doc.createElement('div');
        thumb.className = 'wpg-seek-thumb';
        bar.appendChild(thumb);
        p.element.appendChild(bar);
        S.bar = bar;
        S.thumb = thumb;
        bar.addEventListener('pointerdown', onSeekDown);
        bar.addEventListener('pointermove', onSeekMove);
        bar.addEventListener('pointerup', onSeekUp);
        bar.addEventListener('pointercancel', onSeekUp);
    }

    function seekFraction(e) {
        const r = S.bar.getBoundingClientRect();
        const span = r.width - THUMB_W;
        if (span <= 0) return 0;
        return Math.max(0, Math.min(1, (e.clientX - r.left - THUMB_W / 2) / span));
    }

    function seekTo(frac) {
        const v = S.video;
        if (!v || !(v.duration > 0)) return;
        v.currentTime = frac * v.duration;
        placeThumb(frac);
    }

    function onSeekDown(e) {
        if (e.button !== 0 || !S.video) return;
        e.preventDefault();
        e.stopPropagation();
        S.dragging = true;
        S.bar.setPointerCapture(e.pointerId);
        seekTo(seekFraction(e));
    }

    function onSeekMove(e) {
        if (!S.dragging) return;
        e.stopPropagation();
        seekTo(seekFraction(e));
    }

    function onSeekUp(e) {
        if (!S.dragging) return;
        S.dragging = false;
        if (S.bar.hasPointerCapture(e.pointerId)) S.bar.releasePointerCapture(e.pointerId);
        syncButtons();
    }

    function placeThumb(frac) {
        if (!S.thumb || !S.bar) return;
        const span = S.bar.clientWidth - THUMB_W;
        S.thumb.style.transform = `translateX(${Math.round(Math.max(0, span) * (frac || 0))}px)`;
    }

    function syncThumb() {
        const v = S.video;
        if (S.dragging) return;
        placeThumb(v && v.duration > 0 ? v.currentTime / v.duration : 0);
    }

    function syncButtons() {
        const v = S.video;
        if (!S.play) return;
        const playing = !!v && !v.paused && !v.ended;
        S.play.classList.toggle('is-pause', playing);
        S.play.title = playing ? 'Pause Video (K)' : 'Play Video (H)';
        const broken = !v || !!v.error;
        S.play.disabled = broken;
        S.stop.disabled = broken || (!playing && v.currentTime === 0);
    }

    // ---- playback ----

    function togglePlay() {
        const v = S.video;
        if (!v) return;
        if (v.paused || v.ended) playVideo(); else v.pause();
    }

    function playVideo() {
        const v = S.video;
        if (!v) return;
        if (v.ended) v.currentTime = 0;
        const r = v.play();
        if (r && r.catch) r.catch(() => syncButtons());
    }

    function stopVideo() {
        const v = S.video;
        if (!v) return;
        v.pause();
        v.currentTime = 0;
        syncThumb();
        syncButtons();
    }

    function onVideoEvent(e) {
        const v = e.target;
        if (v !== S.video) return;
        if (e.type === 'timeupdate' || e.type === 'seeked') { syncThumb(); return; }
        if (e.type === 'loadedmetadata') {
            onMetadata(v);
            return;
        }
        if (e.type === 'error') {
            showError(v);
            return;
        }
        if (e.type === 'ended') { syncThumb(); }
        syncButtons();
    }

    /** The real aspect sizes the slide again; the length goes into the item for Info. */
    function onMetadata(v) {
        const c = S.content;
        if (!c || !v.videoWidth || !v.videoHeight) return;
        const { width, height } = sizeFor(v.videoWidth / v.videoHeight);
        c.data.width = width;
        c.data.height = height;
        c.width = width;
        c.height = height;
        const s = c.slide;
        if (s) {
            s.width = width;
            s.height = height;
            s.calculateSize();
            s.currentResolution = 0;
            s.zoomAndPanToInitial();
            s.applyCurrentZoomPan();
            s.updateContentSize(true);
        }
        const d = c.data.data || {};
        if (v.duration > 0 && Number.isFinite(v.duration)) {
            d.duration = v.duration;
            if (root.glancewellLibrary && typeof root.glancewellLibrary.noteVideoLength === 'function') {
                root.glancewellLibrary.noteVideoLength(d.gwItem, v.duration);
            }
        }
        syncButtons();
    }

    /** Photo Gallery's "can't open this picture or video" (PhotoViewer 8108) in place of the video. */
    function showError(v) {
        const box = v.parentNode;
        if (!box || box.querySelector('.wpg-video-error')) return;
        const msg = doc.createElement('div');
        msg.className = 'wpg-video-error';
        msg.textContent = 'Glancewell can’t open this picture or video. This file format is not supported, or the file is not available right now.';
        box.appendChild(msg);
        syncButtons();
    }

    const EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'seeked', 'loadedmetadata', 'error'];

    function bindVideo(v) {
        EVENTS.forEach((t) => v.addEventListener(t, onVideoEvent));
    }

    /** Let go of the file: no source, no connection. */
    function release(v) {
        if (!v) return;
        v.pause();
        if (v.getAttribute('src')) {
            v.removeAttribute('src');
            v.load();
        }
    }

    // ---- PhotoSwipe content ----

    function onContentLoad(e) {
        const c = e.content;
        if (!isVideo(c.data)) return;
        e.preventDefault();
        const box = doc.createElement('div');
        box.className = 'pswp__content wpg-video';
        const v = doc.createElement('video');
        v.playsInline = true;
        v.preload = 'none';
        v.disablePictureInPicture = true;
        v.controls = false;
        bindVideo(v);
        box.appendChild(v);
        c.element = box;
    }

    function onContentActivate(e) {
        activate(e.content);
    }

    /** The shown video gets its source and plays (from contentActivate, or sync when activation came first). */
    function activate(c) {
        if (!c || !isVideo(c.data) || !c.element) return;
        const v = c.element.querySelector('video');
        if (!v || S.video === v) return;
        S.content = c;
        S.video = v;
        if (!v.getAttribute('src')) {
            v.preload = 'auto';
            v.src = c.data.videoSrc;
        }
        playVideo();
        syncThumb();
        syncButtons();
    }

    function onContentDeactivate(e) {
        const c = e.content;
        if (!isVideo(c.data) || !c.element) return;
        const v = c.element.querySelector('video');
        release(v);
        if (S.video === v) {
            S.video = null;
            S.content = null;
        }
    }

    function onContentDestroy(e) {
        const c = e.content;
        if (!isVideo(c.data) || !c.element) return;
        const v = c.element.querySelector('video');
        release(v);
        if (v) EVENTS.forEach((t) => v.removeEventListener(t, onVideoEvent));
        if (S.video === v) {
            S.video = null;
            S.content = null;
        }
    }

    /** H plays, K pauses, Home stops (PhotoViewer's accelerators); a key already taken (a field, Fix) is left. */
    function onKeydown(ev) {
        if (ev.defaultPrevented || !S.video) return;
        const k = ev.originalEvent;
        if (!k || k.ctrlKey || k.altKey || k.metaKey) return;
        const key = String(k.key || '');
        if (key === 'h' || key === 'H') playVideo();
        else if (key === 'k' || key === 'K') S.video.pause();
        else if (key === 'Home') stopVideo();
        else return;
        ev.preventDefault();
    }

    /** Hook one PhotoSwipe instance (lightbox.js openStandalonePhotoSwipe, Glancewell's window only). */
    function attach(p) {
        if (!p || p._glancewellVideo) return;
        p._glancewellVideo = true;
        S.pswp = p;
        p.on('contentLoad', onContentLoad);
        p.on('contentActivate', onContentActivate);
        p.on('contentDeactivate', onContentDeactivate);
        p.on('contentDestroy', onContentDestroy);
        p.on('keydown', onKeydown);
        p.on('resize', () => syncThumb());
        p.on('destroy', () => {
            release(S.video);
            S.video = null;
            S.content = null;
            S.bar = null;
            S.thumb = null;
            if (S.pswp === p) S.pswp = null;
            const sh = shell();
            if (sh) sh.classList.remove('wpg-is-video');
            if (S.play) { S.play.hidden = true; S.stop.hidden = true; }
        });
    }

    /** The chrome for the current slide (lightbox.js syncGlancewellChrome): the video controls or the picture ones. */
    function sync(p) {
        const sh = shell();
        if (!sh || !p) return;
        const data = p.currSlide && p.currSlide.data;
        const video = isVideo(data);
        sh.classList.toggle('wpg-is-video', video);
        if (!ensureChrome(sh)) return;
        S.play.hidden = !video;
        S.stop.hidden = !video;
        if (p.element) ensureSeekBar(p);
        if (S.bar) S.bar.hidden = !video;
        if (video) {
            activate(p.currSlide.content);
            sh.querySelectorAll('[data-gw="rotate-left"], [data-gw="rotate-right"], .wpg-cmds > [data-gw="fix"], .wpg-cmds > [data-gw="print"]').forEach((b) => { b.disabled = true; });
            syncThumb();
        }
        syncButtons();
    }

    root.glancewellVideo = { padding, attach, sync, isVideo, sizeFor };
})(typeof window !== 'undefined' ? window : globalThis);
