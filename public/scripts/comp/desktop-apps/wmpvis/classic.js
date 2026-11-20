// Melaton Media Player: the older visualizations (Windows Media Player 9 Series / 10), a downloadable package
// ('wmpvis-classic', public/scripts/launch/assetPackages.js): Download Visualizations installs it, and
// mediaPlayerViz.js loads this file as a segment once the package is on the computer.
// public/scripts/comp/desktop-apps/wmpvis/classic.js
//
// Spikes (WMP 10 wmp.dll {4B657E70-08EF-11D3-9447-00A0C92A2F2D}; wmploc strings 5505-5507, 5513):
// Spike and Amoeba. Drawn from the collections' description and period references, not yet checked against a
// running WMP 9 / 10 (the Vista VM's WMP 11 cannot host them; an XP VM with WMP 10 is needed for 1:1).
(function () {
    'use strict';

    const TAU = Math.PI * 2;

    function createSpike(canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        let turn = 0;
        return {
            frame(d) {
                const { w, h } = d;
                ctx.fillStyle = 'rgba(0,0,0,0.35)';
                ctx.fillRect(0, 0, w, h);
                turn += 0.004;
                const n = 128;
                const r0 = Math.min(w, h) * 0.08;
                const R = Math.min(w, h) * 0.45;
                ctx.lineWidth = 2;
                for (let i = 0; i < n; i++) {
                    const v = d.freq[Math.floor(i * 384 / n)] / 255;
                    const a = turn + i / n * TAU;
                    ctx.strokeStyle = 'hsl(' + Math.round(200 + v * 160) + ',90%,' + Math.round(35 + v * 30) + '%)';
                    ctx.beginPath();
                    ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
                    ctx.lineTo(w / 2 + Math.cos(a) * (r0 + v * R), h / 2 + Math.sin(a) * (r0 + v * R));
                    ctx.stroke();
                }
            },
            resize() {},
            dispose() {}
        };
    }

    function createAmoeba(canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        let t = 0;
        return {
            frame(d) {
                const { w, h } = d;
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                t += 0.02;
                const n = 96;
                const R = Math.min(w, h) * 0.25;
                const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, R * 1.8);
                grad.addColorStop(0, '#9cff6a');
                grad.addColorStop(0.6, '#2a9c3c');
                grad.addColorStop(1, '#063d1a');
                ctx.fillStyle = grad;
                ctx.beginPath();
                for (let i = 0; i <= n; i++) {
                    const a = i / n * TAU;
                    const v = d.freq[Math.floor((i % n) * 256 / n)] / 255;
                    const r = R * (1 + v * 0.7 + Math.sin(a * 3 + t) * 0.08);
                    const x = w / 2 + Math.cos(a) * r;
                    const y = h / 2 + Math.sin(a) * r;
                    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                }
                ctx.fill();
            },
            resize() {},
            dispose() {}
        };
    }

    document.dispatchEvent(new CustomEvent('melaton:wmp-vis-register', {
        detail: { id: 'spikes', label: 'Spikes', pkg: 'wmpvis-classic', presets: [{ name: 'Spike', create: createSpike }, { name: 'Amoeba', create: createAmoeba }] }
    }));
})();
