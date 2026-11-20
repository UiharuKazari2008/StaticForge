// Melaton Media Player: Alchemy (WMP 11's Alchemy collection, mpvis.dll), its one entry "Random".
// public/scripts/comp/desktop-apps/mediaPlayerVizAlchemy.js
//
// Alchemy draws one of its scenes at random and moves on to another every so often, each fed by the music:
// soft glowing clouds, star figures, mirrored bands, orbs joined by crackling lines, light trails. These
// scenes are drawn after the Vista VM's frames (~/.cache/vista-vm/wmp-eq/viz: alch*, the first Bars captures
// were Alchemy too) with Canvas 2D and a fading feedback buffer; they are not mpvis.dll's own code.
(function () {
    'use strict';

    const TAU = Math.PI * 2;
    const hsl = (h, s, l, a) => 'hsla(' + Math.round(h) + ',' + s + '%,' + l + '%,' + a + ')';

    function energy(d, from, to) {
        let s = 0;
        for (let i = from; i < to; i++) s += d.freq[i];
        return s / ((to - from) * 255);
    }

    const SCENES = [
        // a glowing cloud with turning star figures and a red heart
        (g, d, w, h, t, hue) => {
            const r = Math.min(w, h) * (0.18 + energy(d, 1, 16) * 0.12);
            const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r * 1.6);
            grad.addColorStop(0, hsl(hue + 300, 80, 45, 0.5));
            grad.addColorStop(0.5, hsl(hue + 230, 70, 60, 0.25));
            grad.addColorStop(1, hsl(hue + 230, 70, 30, 0));
            g.fillStyle = grad;
            g.beginPath();
            g.ellipse(w / 2, h / 2, r * 1.6, r * 1.2, 0, 0, TAU);
            g.fill();
            g.strokeStyle = hsl(hue + 50, 70, 70, 0.5);
            for (let s = 0; s < 3; s++) {
                g.beginPath();
                const n = 7 + s * 2;
                for (let i = 0; i <= n * 2; i++) {
                    const a = t * (0.4 + s * 0.2) * (s % 2 ? -1 : 1) + i * Math.PI / n;
                    const rr = r * (i % 2 ? 0.35 : 1) * (0.8 + energy(d, 16 + s * 30, 46 + s * 30));
                    const x = w / 2 + Math.cos(a) * rr;
                    const y = h / 2 + Math.sin(a) * rr * 0.8;
                    if (i) g.lineTo(x, y); else g.moveTo(x, y);
                }
                g.stroke();
            }
            g.fillStyle = hsl(hue + 330, 90, 40, 0.8);
            g.beginPath();
            g.ellipse(w / 2, h / 2, r * 0.22, r * 0.17, 0, 0, TAU);
            g.fill();
        },
        // mirrored bands with a scribble across the middle
        (g, d, w, h, t, hue) => {
            for (let i = 0; i < 10; i++) {
                const e = energy(d, i * 12 + 1, i * 12 + 13);
                const y = h / 2 + (i - 4.5) * h * 0.09;
                g.fillStyle = hsl(hue + 120 + i * 12, 60, 45, 0.18 + e * 0.4);
                const bw = w * (0.3 + e * 0.6);
                g.fillRect((w - bw) / 2, y - h * 0.02, bw, h * 0.04);
            }
            g.strokeStyle = hsl(hue + 340, 70, 70, 0.35);
            g.beginPath();
            for (let x = 0; x < w; x += 4) {
                const v = (d.wave[(x * 2) % d.wave.length] - 128) / 128;
                const y = h / 2 + v * h * 0.35 * Math.sin(x / w * Math.PI);
                if (x) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
        },
        // two orbs on a diagonal, light streaming out of them
        (g, d, w, h, t, hue) => {
            const e = energy(d, 1, 24);
            const pts = [[w * 0.42 + Math.sin(t) * w * 0.05, h * 0.35], [w * 0.58 - Math.sin(t) * w * 0.05, h * 0.65]];
            g.strokeStyle = hsl(hue + 280, 70, 65, 0.15);
            for (let k = 0; k < 40; k++) {
                const a = k / 40 * TAU + t * 0.3;
                const [x, y] = pts[k % 2];
                g.beginPath();
                g.moveTo(x, y);
                g.lineTo(x + Math.cos(a) * w * 0.6, y + Math.sin(a) * h * 0.15);
                g.stroke();
            }
            pts.forEach(([x, y]) => {
                const r = Math.min(w, h) * (0.04 + e * 0.05);
                const grad = g.createRadialGradient(x, y, 0, x, y, r * 2);
                grad.addColorStop(0, 'rgba(255,190,230,0.9)');
                grad.addColorStop(0.4, hsl(hue + 300, 80, 60, 0.5));
                grad.addColorStop(1, hsl(hue + 300, 80, 40, 0));
                g.fillStyle = grad;
                g.beginPath();
                g.arc(x, y, r * 2, 0, TAU);
                g.fill();
            });
        },
        // a crackling line between orbs over a blue haze
        (g, d, w, h, t, hue) => {
            const grad = g.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, hsl(hue + 210, 70, 20, 0.08));
            grad.addColorStop(0.5, hsl(hue + 190, 70, 40, 0.08));
            grad.addColorStop(1, hsl(hue + 220, 70, 15, 0.08));
            g.fillStyle = grad;
            g.fillRect(w * 0.1, 0, w * 0.8, h);
            const a = [w * 0.05, h * 0.05];
            const b = [w * 0.95, h * 0.9];
            g.strokeStyle = 'rgba(200,230,255,0.45)';
            for (let s = 0; s < 3; s++) {
                g.beginPath();
                for (let i = 0; i <= 60; i++) {
                    const f = i / 60;
                    const j = ((d.wave[(i * 13 + s * 50) % d.wave.length] - 128) / 128) * h * 0.05;
                    const x = a[0] + (b[0] - a[0]) * f + j;
                    const y = a[1] + (b[1] - a[1]) * f - j;
                    if (i) g.lineTo(x, y); else g.moveTo(x, y);
                }
                g.stroke();
            }
            [a, b].forEach(([x, y]) => {
                g.fillStyle = 'rgba(200,240,255,0.7)';
                g.beginPath();
                g.arc(x, y, Math.min(w, h) * 0.03, 0, TAU);
                g.fill();
            });
        },
        // a trail of light with orbs riding it
        (g, d, w, h, t, hue) => {
            const e = energy(d, 1, 30);
            g.strokeStyle = hsl(hue + 50, 80, 65, 0.5);
            g.lineWidth = 2;
            g.beginPath();
            const pts = [];
            for (let i = 0; i <= 80; i++) {
                const f = i / 80;
                const x = w * f;
                const y = h * (0.75 - f * 0.5) + Math.sin(f * 9 + t * 2) * h * 0.08 * (0.5 + e);
                pts.push([x, y]);
                if (i) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
            g.lineWidth = 1;
            for (let k = 0; k < 3; k++) {
                const [x, y] = pts[Math.floor(((t * 0.15 + k / 3) % 1) * 80)];
                g.strokeStyle = hsl(hue + 340, 80, 70, 0.8);
                g.fillStyle = hsl(hue + 60, 80, 75, 0.6);
                g.beginPath();
                g.ellipse(x, y, 10 + e * 12, 7 + e * 8, 0, 0, TAU);
                g.fill();
                g.stroke();
            }
        }
    ];

    function createRandom(canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        let scene = Math.floor(Math.random() * SCENES.length);
        let since = 0;
        let hue = Math.random() * 360;
        return {
            frame(d, now) {
                if (!since) since = now;
                if (now - since > 18000) {
                    scene = (scene + 1 + Math.floor(Math.random() * (SCENES.length - 1))) % SCENES.length;
                    hue = Math.random() * 360;
                    since = now;
                }
                const { w, h } = d;
                // the last frame fades (Alchemy's trails), then the scene draws over it
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = 'rgba(0,0,0,0.18)';
                ctx.fillRect(0, 0, w, h);
                ctx.globalCompositeOperation = 'lighter';
                SCENES[scene](ctx, d, w, h, now / 1000, hue);
                ctx.globalCompositeOperation = 'source-over';
            },
            resize() {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            },
            dispose() {}
        };
    }

    document.dispatchEvent(new CustomEvent('melaton:wmp-vis-register', {
        detail: { id: 'alchemy', label: 'Alchemy', presets: [{ name: 'Random', create: createRandom }] }
    }));
})();
