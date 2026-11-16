/**
 * Melaton Mobile: DreamStudio part - Rack (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelRack.js adds what it needs).
 *
 * The desktop's Weight Rack (Prompt menu > Weight Rack, emphasisGroupsToolManager.js) as a full page
 * of its own (Yukimi, Nov 16: "like a main view"), over every prompt field at once: Prompt, the
 * Directive (while Rentan's creative mode is on), UC, the inline negative and each character's prompt
 * and UC. A field with emphasis gets its name as a header, then its text in prompt order: each
 * weight group and each {brace} / [bracket] block a row, the plain text between them a dimmed 1.00
 * row as the desktop shows it.
 *
 * Direct mode (Normalize off, the desktop's default): a row is its weight as a signed LCD, a jog
 * wheel (a brace block steps its NovelAI levels, 1.05^n), the suggested-value button when the
 * weight is well off the attention suggestion (the desktop card's snap button) and the square
 * default button; the header holds Rebalance (the desktop's one-shot Auto Band + Attention Rescale
 * into the prompt) and Normalize.
 *
 * Normalize (per field, as the desktop's window is per field): the field's bar under its header
 * holds the desktop's command bar and range bar - Delta and Distribution, Minimum and Maximum (LCDs:
 * a tap rolls them, a tap on the rolled LCD types them), Pull Band, Auto Band, Attention Rescale and
 * Apply. A group of weight 1 or more takes part: its row's LCD and wheel are its share of the band
 * (Delta: its weight; Distribution: its importance, 50 unbiased) with the weight it maps to beside
 * them, then the suggested-value button and its lock (not in Distribution). Nothing goes into the
 * prompt until Apply, as on the desktop; Menu > the field holds the desktop's right-click rows
 * (Automatic band / rescale, Compensate, Rebalance..., Auto Apply on Generate, Load from Prompt,
 * Clear Config). The state is saved in Studio's emphasis store in the desktop's shape.
 *
 * A tap on a row's text selects it and opens its tools (Merge with Previous Group, Split at Commas,
 * Negative Weight); a tap on an LCD types the value on the number pad (signed weights: minus and
 * point). Show Emphasis Syntax is not here: it switches the desktop's fields between hidden marks
 * and visible weights, and the phone always shows the visible `1.2::text::` form.
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;
    window.wmDreamStudio.extend('Rack', (api, reg) => {
        const { esc } = api;
        // direct mode's jog range and steps (the phone's emphasis range: the editor's has the same)
        const JOG = { min: -3, max: 5, step: 0.1, fineStep: 0.01, def: 1 };
        const OPTS = { normalizePrecision: true, directRangeMapping: true };
        const clampD = (w) => Math.max(JOG.min, Math.min(JOG.max, Math.round(w * 100) / 100));
        const f2 = (w) => Number(w).toFixed(2);
        const f1 = (v) => Number(v).toFixed(1);
        let mx = null;
        const X = () => mx || (mx = api.M.rackMath());

        /** The fields the rack covers, in the program's order (characters last, prompt then UC each). */
        function fields() {
            const out = ['prompt'];
            if (api.M && typeof api.M.directiveOn === 'function' && api.M.directiveOn()) out.push('directive');
            out.push('uc', 'negative');
            (api.read().characters || []).forEach((_, i) => out.push(`c:${i}:prompt`, `c:${i}:uc`));
            return out;
        }

        // ---- a field's targets, read fresh when its text changed

        const seen = {};
        function look(fid) {
            const text = api.fieldValue(fid);
            let v = seen[fid];
            if (!v || v.text !== text) v = seen[fid] = { text, T: api.M.rackTargets(text), P: api.M.rackPortions(text) };
            return v;
        }
        const sig = (T) => JSON.stringify(T.map((t) => t.legacy));

        // ---- Normalize state, a field each (the desktop instance's fields)

        const NS = {};
        const card0 = () => ({ locked: false, importance: X().UNBIASED });
        function fresh(v) {
            return { on: false, min: 1, max: 2, delta: false, dist: false, autoBand: false, autoRescale: false, autoApply: false, stash: null, distApplied: false, sug: [], text: v.text, T: v.T, shares: v.T.map(() => 0), cards: v.T.map(card0), own: 0, carry: null, rescaleAfter: false };
        }

        /** The saved state of a field the desktop (or an earlier visit) normalized. */
        function hydrate(fid, s) {
            const saved = api.M.rackLoadState(fid);
            if (!saved || !saved.enabled) return;
            const x = X();
            s.on = true;
            s.min = x.clampN(saved.minWeight != null ? saved.minWeight : 1);
            s.max = x.clampN(saved.maxWeight != null ? saved.maxWeight : 2);
            s.delta = !!(saved.deltaMode || saved.delta);
            s.dist = !!saved.distribution;
            if (s.dist) s.delta = false;
            s.autoBand = !!saved.autoBand;
            s.autoRescale = !!saved.attentionRescale;
            s.autoApply = !!saved.autoApplyOnGenerate;
            s.T.forEach((t, i) => {
                const share = api.M.rackSavedEntry(saved.percentagesByKey, t);
                if (typeof share === 'number') s.shares[i] = x.clampShare(share);
                else if (Array.isArray(saved.percentages) && typeof saved.percentages[i] === 'number') s.shares[i] = x.clampShare(saved.percentages[i]);
                else s.shares[i] = x.eligible(t.weight) ? x.clampShare(x.weightToShare(t.weight, s.min, s.max, OPTS)) : 0;
                const c = api.M.rackSavedEntry(saved.cards, t);
                if (c) s.cards[i] = { locked: !!(c.deltaLocked || c.rswLocked), importance: Number.isFinite(c.importance) ? c.importance : x.UNBIASED };
            });
        }

        /**
         * The field's state against its text now: a change from elsewhere (the editor, the desktop,
         * Auto Apply) re-encodes the shares from the weights and runs the automatic band / rescale (the
         * desktop does both when its field loses focus); the rack's own writes keep them.
         */
        function state(fid) {
            const v = look(fid);
            let s = NS[fid];
            if (!s) {
                s = NS[fid] = fresh(v);
                hydrate(fid, s);
                refreshSug(fid, s);
                return s;
            }
            if (s.text === v.text) return s;
            const x = X();
            const same = sig(s.T) === sig(v.T);
            const own = Date.now() < s.own;
            const prev = new Map();
            s.T.forEach((t, i) => { if (!prev.has(t.legacy)) prev.set(t.legacy, { card: s.cards[i], share: s.shares[i] }); });
            const cards = v.T.map((t, i) => (same ? s.cards[i] : ((prev.get(t.legacy) || {}).card || card0())));
            const shares = v.T.map((t, i) => (same ? (s.shares[i] || 0) : ((prev.get(t.legacy) || {}).share)));
            s.T = v.T;
            s.text = v.text;
            s.cards = cards;
            s.shares = shares.map((n) => n || 0);
            if (s.on) {
                if (!own) {
                    // Automatic Band never sits under the peak weight: widened first, so a weight
                    // typed above the band is read as written, not cut to the old maximum
                    if (s.autoBand) activeOf(s).forEach((i) => { if (!locked(s, i) && s.T[i].weight > s.max) s.max = x.clampN(s.T[i].weight); });
                    initShares(s);
                } else {
                    // groups new to the field (a split, a merge) start from their weights; a merged
                    // group takes the sum of the two shares (the desktop's merge)
                    shares.forEach((n, i) => { if (n == null && x.eligible(s.T[i].weight)) s.shares[i] = x.clampShare(x.weightToShare(s.T[i].weight, s.min, s.max, OPTS)); });
                    if (s.carry) {
                        const i = s.T.findIndex((t) => t.type === 'group' && String(t.innerText || '').trim() === s.carry.inner);
                        if (i >= 0) { s.shares[i] = s.carry.share; s.cards[i] = { locked: s.carry.locked, importance: s.carry.importance }; }
                    }
                }
                s.carry = null;
                refreshSug(fid, s);
                if (s.rescaleAfter) { s.rescaleAfter = false; attentionRescale(fid, s); }
                if (!own && (s.autoBand || s.autoRescale)) liveAutos(fid, s);
                persist(fid);
            } else refreshSug(fid, s);
            return s;
        }

        const persistTimers = {};
        function persist(fid) {
            clearTimeout(persistTimers[fid]);
            persistTimers[fid] = setTimeout(() => persistNow(fid), 150);
        }
        /** The desktop rack's bag (_persistForgeState), with the plain-text keys and their legacy keys. */
        function persistNow(fid) {
            const s = NS[fid];
            if (!s) return;
            if (!s.on) { api.M.rackSaveState(fid, null); return; }
            const x = X();
            const cards = {};
            const percentagesByKey = {};
            const percentages = s.T.map((t, i) => {
                const c = s.cards[i] || card0();
                const meta = { deltaLocked: !!c.locked, importance: Number.isFinite(c.importance) ? c.importance : x.UNBIASED };
                const p = x.clampShare(s.shares[i] || 0);
                cards[t.key] = meta;
                cards[t.legacy] = meta;
                percentagesByKey[t.key] = p;
                percentagesByKey[t.legacy] = p;
                return p;
            });
            api.M.rackSaveState(fid, {
                enabled: true,
                minWeight: s.min,
                maxWeight: s.max,
                delta: s.delta,
                distribution: s.dist,
                deltaMode: s.delta,
                autoBand: s.autoBand,
                attentionRescale: s.autoRescale,
                autoApplyOnGenerate: s.autoApply,
                percentages,
                percentagesByKey,
                cards,
                preNormalizeWeights: {}
            });
        }

        // ---- the desktop's Normalize math (emphasisGroupsToolManager.js), on the field's state

        const isPart = (s, i) => s.on && !!s.T[i] && X().eligible(s.T[i].weight);
        const locked = (s, i) => s.on && !!(s.cards[i] && s.cards[i].locked);
        const activeOf = (s) => s.T.map((_, i) => i).filter((i) => !s.on || X().eligible(s.T[i].weight));
        const weightingOf = (s) => activeOf(s).filter((i) => !locked(s, i));
        const impOf = (s, i) => (s.cards[i] && Number.isFinite(s.cards[i].importance) ? s.cards[i].importance : X().UNBIASED);

        /** The weights the shares map to (a locked group keeps its own). */
        function displayWeights(s) {
            const act = activeOf(s);
            const w = weightingOf(s);
            const from = X().sharesToWeights(s.shares, s.min, s.max, w.length ? w : act, OPTS);
            const out = [];
            act.forEach((i) => { out[i] = locked(s, i) || from[i] === undefined ? s.T[i].weight : from[i]; });
            return out;
        }
        function initShares(s, mn = s.min, mxw = s.max) {
            const x = X();
            s.shares = s.T.map(() => 0);
            activeOf(s).forEach((i) => { if (x.eligible(s.T[i].weight)) s.shares[i] = x.clampShare(x.weightToShare(s.T[i].weight, mn, mxw, OPTS)); });
        }
        function sharesFromWeights(s, W) {
            const x = X();
            activeOf(s).forEach((i) => { if (!locked(s, i) && W[i] !== undefined) s.shares[i] = x.clampShare(x.weightToShare(W[i], s.min, s.max, OPTS)); });
        }
        function importanceFromShare(share, n) {
            const u = X().UNBIASED;
            const equal = 100 / Math.max(1, n || 1);
            const ratio = (Number(share) || 0) / equal;
            return X().clampShare(ratio >= 1 ? u + (ratio - 1) * u : ratio * u);
        }
        function distribution(fid, s, idx, withImp) {
            let imp;
            if (withImp && s.dist) { imp = []; idx.forEach((i) => { imp[i] = impOf(s, i); }); }
            return api.M.rackDistribution(fid, s.T, idx, imp);
        }
        /** The attention suggestion each group's notch / snap button reads (the desktop's distribution cache). */
        function refreshSug(fid, s) {
            const w = weightingOf(s);
            const idx = w.length ? w : activeOf(s);
            s.sug = idx.length ? (distribution(fid, s, idx).suggestedOptimalByLocalIndex || []) : [];
        }

        /** Direct mode's track for a group (the desktop slider's: negative [-max(4, top), 1], else [low, top]). */
        function directBounds(s, i) {
            const x = X();
            const w = s.T[i].weight;
            if (Number.isFinite(w) && w < 1) return { min: -Math.max(s.max, 4), max: 1 };
            const ws = s.T.map((t) => t.weight).filter((n) => Number.isFinite(n) && n >= 1);
            const cur = s.on ? 1 : s.min;
            if (!ws.length) return { min: cur, max: Math.max(s.max, 2) };
            let lo = Math.min(cur, x.clampW(Math.min(...ws)));
            let hi = Math.max(s.max, x.clampW(Math.max(...ws)));
            if (hi <= lo) hi = x.clampW(lo + x.RANGE_STEP);
            return { min: lo, max: hi };
        }

        /** Where a group stands against its suggestion, on the axis its wheel moves (or null). */
        function axis(s, i) {
            const x = X();
            const t = s.T[i];
            if (!t) return null;
            if (s.on && (!isPart(s, i) || locked(s, i))) return null;
            let lo; let hi; let cur; let sug;
            if (s.on && s.dist) { lo = 0; hi = 100; cur = impOf(s, i); sug = x.UNBIASED; } else if (s.on && s.delta) {
                lo = s.min; hi = s.max; cur = displayWeights(s)[i]; sug = s.sug[i];
            } else if (s.on) {
                lo = 0; hi = 100; cur = s.shares[i] || 0;
                if (!Number.isFinite(s.sug[i])) return null;
                sug = x.weightToShare(s.sug[i], s.min, s.max, OPTS);
            } else {
                ({ min: lo, max: hi } = directBounds(s, i));
                cur = t.weight; sug = s.sug[i];
            }
            if (!Number.isFinite(sug) || !Number.isFinite(cur) || !(hi - lo > 0)) return null;
            return { cur, sug, curPct: ((cur - lo) / (hi - lo)) * 100, sugPct: ((sug - lo) / (hi - lo)) * 100 };
        }
        /** The snap button shows when the value is 5% of the track under its suggestion, or 20% over. */
        function snapInfo(s, i) {
            const a = axis(s, i);
            if (!a) return null;
            if (a.curPct < a.sugPct - 5) return { kind: 'under', sug: a.sug };
            if (a.curPct > a.sugPct + 20) return { kind: 'over', sug: a.sug };
            return null;
        }

        function changeWeightP(s, i, v) {
            if (locked(s, i)) return;
            const x = X();
            const act = activeOf(s);
            const w = x.clampN(v);
            const cur = displayWeights(s);
            const adj = weightingOf(s);
            let next;
            if (s.delta && adj.length > 1 && adj.includes(i)) {
                const lens = [];
                act.forEach((j) => { lens[j] = x.sectionLength(s.T[j].innerText); });
                next = x.rebalanceWeightsByDelta(cur, i, w, act, act.filter((j) => locked(s, j)), lens);
            } else { next = cur.slice(); next[i] = w; }
            sharesFromWeights(s, next);
        }
        function changeShareP(s, i, v) {
            const x = X();
            const share = x.clampShare(v);
            if (s.dist) { s.cards[i] = Object.assign({}, s.cards[i] || card0(), { importance: share }); return; }
            if (locked(s, i)) return;
            if (!s.delta) { s.shares[i] = share; return; }
            const act = activeOf(s);
            const lk = act.filter((j) => locked(s, j));
            s.shares = lk.length ? x.rebalanceSharesByDelta(s.shares, i, share, act, lk) : x.rebalanceShares(s.shares, i, share, act);
        }

        /** Re-encode shares so the weights stay put under a new band (Auto Band, a Delta range edit). */
        function keepWeightsForRange(s, oldMin, oldMax) {
            if (oldMin === s.min && oldMax === s.max) return;
            const x = X();
            const act = activeOf(s);
            const w = weightingOf(s);
            const ws = x.sharesToWeights(s.shares, oldMin, oldMax, w.length ? w : act, OPTS);
            act.forEach((i) => {
                const wt = locked(s, i) || ws[i] === undefined ? s.T[i].weight : ws[i];
                s.shares[i] = x.clampShare(x.weightToShare(wt, s.min, s.max, OPTS));
            });
        }
        function afterRange(s, oldMin, oldMax, user) {
            if (user) { if (s.delta) keepWeightsForRange(s, oldMin, oldMax); return; }
            if (!s.dist) keepWeightsForRange(s, oldMin, oldMax);
        }

        /** Minimum / Maximum typed or rolled (the desktop's range inputs: 4 places, minimum at least 1). */
        function setRange(fid, which, v) {
            const s = NS[fid];
            if (!s || !s.on || s.autoBand) return;
            const x = X();
            const oldMin = s.min;
            const oldMax = s.max;
            if (which === 'min') s.min = x.clampN(v); else s.max = x.clampN(v);
            s.min = Math.max(1, s.min);
            if (s.min > s.max) { const t = s.min; s.min = s.max; s.max = t; }
            afterRange(s, oldMin, oldMax, true);
            persist(fid);
            update(fid);
        }

        function applyAutoShares(s, weighting, d) {
            const x = X();
            const rel = Array.isArray(d.relativeImportances) ? d.relativeImportances : (d.importances || []);
            const sugs = d.suggestedOptimalByLocalIndex || [];
            weighting.forEach((i, rank) => {
                let share;
                if (Number.isFinite(sugs[i])) share = x.clampShare(x.weightToShare(sugs[i], s.min, s.max, OPTS));
                else {
                    const local = d.relativeImportancesByLocalIndex ? d.relativeImportancesByLocalIndex[i] : undefined;
                    share = x.clampShare(local !== undefined ? local : (rel[rank] || 0));
                }
                s.shares[i] = share;
                if (s.dist) s.cards[i] = Object.assign({}, s.cards[i] || card0(), { importance: importanceFromShare(share, weighting.length) });
            });
        }
        /** The peak unlocked weight sits at 50% of the track at least (max widened, weights kept). */
        function bandFloor(s) {
            if (!s.on || s.dist) return;
            const x = X();
            const w = weightingOf(s);
            const idx = w.length ? w : activeOf(s);
            if (!idx.length) return;
            const ws = displayWeights(s);
            let peak = 0;
            idx.forEach((i) => { if (Number.isFinite(ws[i])) peak = Math.max(peak, ws[i]); });
            if (!(peak > s.min)) return;
            if (x.weightToShare(peak, s.min, s.max, OPTS) >= x.BAND_MIN - 0.0001) return;
            const next = x.clampN(s.min + ((peak - s.min) * 100) / x.BAND_MIN);
            if (!(next > s.min) || Math.abs(next - s.max) < 0.00005) return;
            s.max = next;
            idx.forEach((i) => { if (!locked(s, i) && Number.isFinite(ws[i])) s.shares[i] = x.clampShare(x.weightToShare(ws[i], s.min, s.max, OPTS)); });
        }

        /** Auto Band: minimum 1, maximum the NovelAI-safe ideal top (never below the peak weight now). */
        function autoBand(fid, s) {
            const x = X();
            const act = activeOf(s);
            if (!act.length) return;
            const w = weightingOf(s);
            const idx = w.length ? w : act;
            const d = distribution(fid, s, idx);
            const oldMin = s.min;
            const oldMax = s.max;
            const kept = displayWeights(s);
            s.min = 1;
            let next = Math.max(1, x.idealMax(d, idx));
            let peak = 0;
            idx.forEach((i) => { if (Number.isFinite(kept[i])) peak = Math.max(peak, kept[i]); });
            if (peak > next) next = peak;
            s.max = next;
            if (!s.dist && (oldMin !== s.min || oldMax !== s.max)) {
                sharesFromWeights(s, kept);
                act.forEach((i) => { if (locked(s, i)) s.shares[i] = x.clampShare(x.weightToShare(s.T[i].weight, s.min, s.max, OPTS)); });
            } else afterRange(s, oldMin, oldMax, false);
            if (!s.dist) bandFloor(s);
        }
        /** Attention Rescale: unlocked shares from the attention-equalized ranks (band and prompt untouched). */
        function attentionRescale(fid, s) {
            const w = weightingOf(s);
            if (!w.length) return;
            applyAutoShares(s, w, distribution(fid, s, w));
        }
        /** Both automatic ones after a change from elsewhere (the desktop's _maybeRunLiveAutos). */
        function liveAutos(fid, s) {
            if (s.autoBand && s.autoRescale) {
                const x = X();
                const w = weightingOf(s);
                if (!w.length) return;
                const oldMin = s.min;
                const oldMax = s.max;
                const kept = displayWeights(s);
                const d = distribution(fid, s, w);
                s.min = 1;
                let next = Math.max(1, x.idealMax(d, w));
                let peak = 0;
                w.forEach((i) => { if (Number.isFinite(kept[i])) peak = Math.max(peak, kept[i]); });
                if (peak > next) next = peak;
                s.max = next;
                afterRange(s, oldMin, oldMax, false);
                applyAutoShares(s, w, d);
                return;
            }
            if (s.autoBand) autoBand(fid, s);
            if (s.autoRescale) attentionRescale(fid, s);
        }
        /** Pull Band: the peak share to 100%, the maximum to that weight (not in Distribution). */
        function pullBand(s) {
            if (!s.on || s.dist) return;
            const x = X();
            const w = weightingOf(s);
            const idx = w.length ? w : activeOf(s);
            const ws = displayWeights(s);
            let peak = 0;
            idx.forEach((i) => { if (Number.isFinite(ws[i])) peak = Math.max(peak, ws[i]); });
            if (!(peak > s.min)) return;
            s.max = x.clampN(peak);
            idx.forEach((i) => { if (!locked(s, i)) s.shares[i] = x.clampShare(x.weightToShare(ws[i], s.min, s.max, OPTS)); });
        }
        /** Compensate: groups under their suggestion go up to it; the rest stay. */
        function compensate(fid, s) {
            refreshSug(fid, s);
            const w = weightingOf(s);
            const under = w.map((i) => [i, axis(s, i)]).filter(([, a]) => a && a.curPct < a.sugPct - 0.0001);
            if (!under.length) return;
            const x = X();
            if (s.dist) { under.forEach(([i, a]) => { s.cards[i] = Object.assign({}, s.cards[i], { importance: a.sug }); }); syncSharesFromImportance(fid, s); } else if (s.delta) {
                const ws = displayWeights(s);
                under.forEach(([i, a]) => { ws[i] = a.sug; });
                sharesFromWeights(s, ws);
            } else under.forEach(([i, a]) => { s.shares[i] = x.clampShare(a.sug); });
        }
        function syncSharesFromImportance(fid, s) {
            const x = X();
            const w = weightingOf(s);
            const idx = w.length ? w : activeOf(s);
            const d = distribution(fid, s, idx, true);
            const rel = d.relativeImportancesByLocalIndex || {};
            idx.forEach((i) => { if (!locked(s, i) && rel[i] !== undefined) s.shares[i] = x.clampShare(rel[i]); });
        }
        function snapTo(fid, s, i) {
            const info = snapInfo(s, i);
            if (!info) return;
            if (s.on && s.delta) changeWeightP(s, i, info.sug);
            else if (s.on) changeShareP(s, i, info.sug);
            else { setWeight(fid, i, s.T[i].type === 'brace' ? X().snapBrace(info.sug) : clampD(info.sug), false); flush(fid); return; }
            persist(fid);
            update(fid);
        }

        function enable(fid, s) {
            const x = X();
            const eligible = s.T.filter((t) => x.eligible(t.weight)).length;
            if (!eligible) {
                api.sh.messageBox({ title: 'Weight Rack', text: 'No emphasis groups with weight >= 1 to normalize.', icon: 'info', modal: true });
                return;
            }
            const b = (() => { const ws = s.T.map((t) => t.weight).filter((n) => Number.isFinite(n) && n >= 1); let lo = Math.min(s.min, x.clampW(Math.min(...ws))); let hi = Math.max(s.max, x.clampW(Math.max(...ws))); if (hi <= lo) hi = x.clampW(lo + x.RANGE_STEP); return { lo, hi }; })();
            s.on = true;
            s.autoBand = false;
            s.autoRescale = false;
            s.autoApply = false;
            s.min = Math.max(1, x.clampN(b.lo));
            s.max = x.clampN(b.hi);
            if (s.max <= s.min) s.max = x.clampN(s.min + x.RANGE_STEP);
            s.cards = s.T.map((_, i) => s.cards[i] || card0());
            initShares(s, b.lo, b.hi);
            refreshSug(fid, s);
        }
        function disable(fid, s) {
            s.on = false;
            s.autoBand = false;
            s.autoRescale = false;
            s.autoApply = false;
            s.stash = null;
            refreshSug(fid, s);
        }
        function setDelta(s, on) { s.delta = !!on; if (s.delta) s.dist = false; }
        /** Distribution: importance from each share (50 = an equal share); off again without Apply puts the shares back. */
        function setDist(s, on) {
            if (!!on === s.dist) return;
            const act = activeOf(s);
            if (on) {
                s.stash = { min: s.min, max: s.max, cards: act.map((i) => ({ i, share: s.shares[i], importance: impOf(s, i) })) };
                s.distApplied = false;
                s.dist = true;
                s.delta = false;
                if (!act.some((i) => (s.shares[i] || 0) > 0) && act.length) initShares(s);
                act.forEach((i) => { s.cards[i] = Object.assign({}, s.cards[i] || card0(), { importance: importanceFromShare(s.shares[i] || 0, act.length) }); });
                return;
            }
            if (!s.distApplied && s.stash) {
                s.min = s.stash.min;
                s.max = s.stash.max;
                s.stash.cards.forEach(({ i, share, importance }) => { if (!s.T[i]) return; s.shares[i] = share; s.cards[i] = Object.assign({}, s.cards[i] || card0(), { importance }); });
            }
            s.stash = null;
            s.dist = false;
            if (s.distApplied && act.length) initShares(s);
            s.distApplied = false;
        }
        /** Apply: the previewed weights into the prompt (braces snap to their levels). */
        function applyNormalize(fid, s) {
            if (!s.on || !weightingOf(s).length) return;
            const x = X();
            if (s.dist) syncSharesFromImportance(fid, s);
            const w = weightingOf(s);
            const preview = s.dist ? displayWeights(s) : x.sharesToWeights(s.shares, s.min, s.max, w, OPTS);
            w.forEach((i) => {
                let wt = preview[i];
                if (wt === undefined) return;
                if (s.T[i].type === 'brace') wt = x.snapBrace(wt);
                s.shares[i] = x.clampShare(x.weightToShare(wt, s.min, s.max, OPTS));
            });
            const ws = displayWeights(s);
            const byIndex = new Map();
            s.T.forEach((t, i) => {
                let wt = t.weight;
                if (!locked(s, i) && isPart(s, i) && ws[i] !== undefined) wt = t.type === 'brace' ? x.snapBrace(ws[i]) : ws[i];
                byIndex.set(i, wt);
            });
            if (s.dist) { s.distApplied = true; s.stash = null; }
            persist(fid);
            writeWeights(fid, byIndex, true);
        }
        function loadFromPrompt(s) {
            const act = activeOf(s);
            if (!act.length) return;
            initShares(s);
            if (s.dist) act.forEach((i) => { s.cards[i] = Object.assign({}, s.cards[i] || card0(), { importance: importanceFromShare(s.shares[i] || 0, act.length) }); });
            s.stash = null;
            s.distApplied = false;
        }
        function clearConfig(fid) {
            const v = look(fid);
            NS[fid] = fresh(v);
            refreshSug(fid, NS[fid]);
            api.M.rackSaveState(fid, null);
        }
        /** Rebalance (the desktop's blender, Normalize off): one-shot band + attention rescale into the weights. */
        function rebalanceDirect(fid, s) {
            const x = X();
            const idx = s.T.map((t, i) => (x.eligible(t.weight) ? i : -1)).filter((i) => i >= 0);
            if (!idx.length) return;
            const d = api.M.rackDistribution(fid, s.T, idx);
            const top = Math.max(1, x.idealMax(d, idx));
            s.min = 1;
            s.max = top;
            const rel = Array.isArray(d.relativeImportances) ? d.relativeImportances : (d.importances || []);
            const byIndex = new Map();
            idx.forEach((i, k) => {
                const local = d.relativeImportancesByLocalIndex ? d.relativeImportancesByLocalIndex[i] : undefined;
                let wt = x.weightFromRel(local !== undefined ? local : (rel[k] || 0), top);
                if (s.T[i].type === 'brace') wt = x.snapBrace(wt);
                byIndex.set(i, x.clampN(wt));
            });
            writeWeights(fid, byIndex, false);
        }

        /** Rebalance Weights (Distribution's Attention Rescale menu): the top weight, then shares from the ranks. */
        function rebalanceDialog(fid) {
            const s = NS[fid];
            if (!s || !s.on) return;
            const x = X();
            const w = weightingOf(s);
            if (!w.length) return;
            const d = distribution(fid, s, w);
            let top = Math.max(1, x.idealMax(d, w));
            const el = api.openDlg('Rebalance Weights', 'wds-rack-rebal', `${api.ui.note('Rebalancing ranks unlocked groups so short concept anchors keep attention against longer phrases, then maps those ranks into weights between 1 and the top weight below.')}`
                + '<div class="wds-wt-row is-on"><span class="wds-wt-name">Top weight</span><button type="button" class="wds-wt-lcd wm-lcd" aria-label="Top weight"></button></div>'
                + '<div class="wm-msgbox-buttons"><button type="button" data-rb="ok">Rebalance</button><button type="button" data-rb="cancel">Cancel</button></div>');
            const row = el.querySelector('.wds-wt-row');
            const lcd = row.querySelector('.wds-wt-lcd');
            const show = () => api.ui.segText(lcd, f2(top));
            show();
            const jog = api.ui.jogWheel(row, { label: 'Top weight', value: top, min: 1, max: Infinity, step: x.RANGE_STEP, fineStep: 0.01, stepPx: 18, zeroStop: 0, onChange: (v) => { top = Math.max(1, x.clampN(v)); show(); } });
            lcd.addEventListener('click', () => api.ui.numPad({ title: 'Top weight', value: String(top), point: true, max: 6, onOk: (t) => { const n = parseFloat(t); if (!Number.isFinite(n)) return; top = Math.max(1, x.clampN(n)); jog.set(top); show(); } }));
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-rb]');
                if (!b) return;
                if (b.dataset.rb === 'ok') {
                    s.min = 1;
                    s.max = top;
                    applyAutoShares(s, w, d);
                    persist(fid);
                }
                api.closeDlg();
                update(fid);
            });
        }

        // ---- writing: a field's text is read fresh per write; writes to one field queue up behind
        // each other (each waits for the last to reach Studio)

        const pending = {};
        const timers = {};
        const chains = {};
        const busy = {};
        const rowKey = (fid, k) => `${fid}|${k}`;

        function queue(fid, job) {
            chains[fid] = (chains[fid] || Promise.resolve()).then(() => {
                api.refresh();
                const text = api.fieldValue(fid);
                const out = job(text);
                if (out == null || out === text) return null;
                if (NS[fid]) NS[fid].own = Date.now() + 2500;
                return api.fieldSet(fid, out);
            }).catch((err) => console.warn('[wmDreamStudio] rack', fid, err));
            return chains[fid];
        }

        /** Weights by target place into the field (precise: Normalize's 4 places). */
        function writeWeights(fid, byIndex, precise) {
            return queue(fid, (text) => {
                const T = api.M.rackTargets(text);
                const map = new Map();
                byIndex.forEach((w, k) => { if (T[k]) map.set(T[k].start, w); });
                return map.size ? api.M.rackApply(text, map, precise) : null;
            }).then(() => api.paint());
        }

        function flush(fid) {
            clearTimeout(timers[fid]);
            const map = pending[fid];
            delete pending[fid];
            if (!map || !map.size) return chains[fid] || Promise.resolve();
            const s = NS[fid];
            return writeWeights(fid, map, !!(s && s.on));
        }

        /** A direct weight rolled or typed: shown at once, written once the finger rests. */
        function setWeight(fid, k, w, hold = true) {
            // a row being rolled keeps its own figures for a moment (Studio's echo of an older step must not jump it back)
            if (hold) busy[rowKey(fid, k)] = Date.now() + 900;
            (pending[fid] = pending[fid] || new Map()).set(k, w);
            clearTimeout(timers[fid]);
            timers[fid] = setTimeout(() => flush(fid), 120);
        }

        /** A change to the field's targets themselves (merge, split): pending weights go first. */
        function restructure(fid, job) {
            return flush(fid).then(() => queue(fid, job)).then(() => { selected = null; api.paint(); });
        }

        // ---- a group's tools (the desktop card's buttons)

        let selected = null; // { fid, k }

        function merge(fid, k) {
            const s = state(fid);
            const a = s.T[k - 1];
            const b = s.T[k];
            if (s.on && a && b) {
                const x = X();
                s.carry = {
                    inner: `${String(a.innerText || '').trim()}${s.text.slice(a.end, b.start)}${String(b.innerText || '').trim()}`,
                    share: x.clampShare((s.shares[k - 1] || 0) + (s.shares[k] || 0)),
                    importance: x.clampShare((impOf(s, k - 1) + impOf(s, k)) / 2),
                    locked: locked(s, k - 1) || locked(s, k)
                };
            }
            restructure(fid, (text) => api.M.rackMerge(text, api.M.rackTargets(text), k));
        }
        function split(fid, k) {
            const s = state(fid);
            if (s.on) s.rescaleAfter = true;
            restructure(fid, (text) => { const t = api.M.rackTargets(text)[k]; return t ? api.M.rackSplit(text, t) : null; });
        }
        /**
         * The desktop card's sign button: to negative keeps a weight already under 1 and makes any
         * other one -|w|; to positive the range starts at 1 (a weight under 1 in size becomes 1).
         */
        function flipSign(fid, k) {
            const t = state(fid).T[k];
            if (!t) return;
            const w = t.weight < 1 ? (Math.abs(t.weight) < 1 ? 1 : Math.abs(t.weight)) : -Math.abs(t.weight);
            setWeight(fid, k, clampD(w), false);
            flush(fid);
        }

        function groupRows(sel) {
            const s = sel ? state(sel.fid) : null;
            const t = s ? s.T[sel.k] : null;
            const part = !!t && isPart(s, sel.k);
            return [
                { label: 'Merge with Previous Group', disabled: !t || !api.M.rackCanMerge(s.text, s.T, sel.k), action: () => merge(sel.fid, sel.k) },
                { label: 'Split at Commas', disabled: !t || !api.M.rackCanSplit(t), action: () => split(sel.fid, sel.k) },
                '-',
                // a brace block has no sign of its own, and a group taking part in Normalize has no sign button (the desktop's)
                { label: 'Negative Weight', checked: !!t && t.weight < 1, disabled: !t || t.type === 'brace' || part, action: () => flipSign(sel.fid, sel.k) }
            ];
        }

        /** The Normalize rows of a field (the desktop's right-click menus on Auto Band, Rescale and Apply). */
        function normRows(fid) {
            const s = NS[fid];
            if (!s || !s.on) return [];
            const done = () => { persist(fid); api.paint(); update(fid); };
            const rows = [
                { label: 'Automatic Band', checked: s.autoBand, action: () => { s.autoBand = !s.autoBand; if (s.autoBand) autoBand(fid, s); done(); } },
                { label: 'Automatic Rescale', checked: s.autoRescale, action: () => { s.autoRescale = !s.autoRescale; if (s.autoRescale) attentionRescale(fid, s); done(); } },
                { label: 'Compensate', action: () => { compensate(fid, s); done(); } }
            ];
            if (s.dist) rows.push({ label: 'Rebalance...', action: () => rebalanceDialog(fid) });
            rows.push('-',
                { label: 'Auto Apply on Generate', checked: s.autoApply, action: () => { s.autoApply = !s.autoApply; done(); } },
                { label: 'Load from Prompt', action: () => { loadFromPrompt(s); done(); } },
                { label: 'Clear Config', action: () => { clearConfig(fid); api.paint(); } });
            return rows;
        }

        /** Convert {}/[] for a field (its brace / bracket blocks become weight groups). */
        function convertField(fid) {
            restructure(fid, (text) => api.M.rackBraceSpans(text).reduce((out, sp) => `${out.slice(0, sp.start)}${sp.text}${out.slice(sp.end)}`, text));
        }
        function convertRows() {
            const list = fields().filter((fid) => api.M.rackBraceSpans(api.fieldValue(fid)).length);
            return list.length ? [{ label: 'Convert {}/[]', submenu: () => list.map((fid) => ({ label: api.fieldName(fid), action: () => convertField(fid) })) }] : [];
        }

        // ---- typing a value

        function padWeight(fid, k, now) {
            api.ui.numPad({
                title: 'Weight',
                value: f2(now).replace(/\.?0+$/, ''),
                minus: true,
                point: true,
                max: 5,
                onOk: (t) => {
                    const n = parseFloat(t);
                    if (!Number.isFinite(n)) return;
                    const s = state(fid);
                    setWeight(fid, k, s.T[k] && s.T[k].type === 'brace' ? X().snapBrace(n) : clampD(n), false);
                    flush(fid);
                }
            });
        }
        function padNorm(fid, i) {
            const s = state(fid);
            const weight = s.delta;
            const now = weight ? displayWeights(s)[i] : (s.dist ? impOf(s, i) : s.shares[i] || 0);
            api.ui.numPad({
                title: weight ? 'Weight' : (s.dist ? 'Importance' : 'Share'),
                value: (weight ? f2(now) : f1(now)).replace(/\.?0+$/, ''),
                point: true,
                max: 6,
                onOk: (t) => {
                    const n = parseFloat(t);
                    if (!Number.isFinite(n)) return;
                    if (weight) changeWeightP(s, i, n); else changeShareP(s, i, n);
                    persist(fid);
                    update(fid);
                }
            });
        }
        function rangePop(fid, which, anchor) {
            const s = NS[fid];
            if (!s || !s.on || s.autoBand) return;
            const label = which === 'min' ? 'Minimum' : 'Maximum';
            const pop = api.ui.valuePop(anchor, {
                label,
                min: 1,
                max: Infinity,
                step: X().RANGE_STEP,
                fineStep: 0.01,
                digits: 2,
                value: which === 'min' ? s.min : s.max,
                def: which === 'min' ? 1 : 2,
                onChange: (v) => setRange(fid, which, v)
            });
            // a tap on the rolled value types it
            const lcd = pop && pop.el && pop.el.querySelector('.wm-valuepop-lcd');
            if (lcd) {
                lcd.classList.add('is-tap');
                lcd.addEventListener('click', () => {
                    pop.close();
                    api.ui.numPad({ title: label, value: String(which === 'min' ? s.min : s.max), point: true, max: 6, onOk: (t) => { const n = parseFloat(t); if (Number.isFinite(n)) setRange(fid, which, n); } });
                });
            }
        }

        // ---- the page

        let shape = '';
        let pageEl = null;
        let rows = {}; // rowKey -> { lcd, jog, wt, snap, lock }

        const tool = (act, label, icon, extra = '') => `<button type="button" class="wm-tool" data-act="${act}" aria-label="${esc(label)}" title="${esc(label)}"${extra}>${api.toolIcon(icon)}</button>`;
        const textTool = (act, label, pressed) => `<button type="button" class="wm-tool is-text" data-act="${act}" aria-pressed="${pressed ? 'true' : 'false'}">${esc(label)}</button>`;

        function headHtml(fid, s) {
            const x = X();
            const anyEligible = s.T.some((t) => x.eligible(t.weight));
            return `<div class="wds-rack-head"><span class="wds-rack-title">${esc(api.fieldName(fid))}</span>`
                + `${!s.on && anyEligible ? tool('rebalance', 'Rebalance (band and attention rescale into the weights)', 'fas fa-blender') : ''}`
                + `${tool('normalize', 'Normalize', 'fas fa-chart-pie', ` aria-pressed="${s.on ? 'true' : 'false'}"`)}</div>`;
        }
        function barHtml(s) {
            if (!s.on) return '';
            return '<div class="wm-toolbar wds-rack-bar">'
                + `<div class="wm-toolbar-group">${textTool('delta', 'Delta', s.delta)}${textTool('dist', 'Distribution', s.dist)}</div>`
                + `<div class="wm-toolbar-group"><span class="wm-tool-sep" aria-hidden="true"></span>${s.dist ? '' : '<button type="button" class="wm-tool is-text wm-lcd" data-act="min" aria-label="Minimum" title="Minimum" aria-haspopup="dialog"></button>'}<button type="button" class="wm-tool is-text wm-lcd" data-act="max" aria-label="Maximum" title="Maximum" aria-haspopup="dialog"></button></div>`
                + `<div class="wm-toolbar-group"><span class="wm-tool-sep" aria-hidden="true"></span>${s.dist ? '' : tool('pull', 'Pull Band', 'fas fa-compress')}${tool('autoband', 'Auto Band', 'fas fa-wand-magic-sparkles', ` aria-pressed="${s.autoBand ? 'true' : 'false'}"`)}${tool('rescale', 'Attention Rescale', 'fas fa-scale-balanced', ` aria-pressed="${s.autoRescale ? 'true' : 'false'}"`)}</div>`
                + `<div class="wm-toolbar-group"><span class="wm-tool-sep" aria-hidden="true"></span>${tool('apply', 'Apply', 'fas fa-check')}</div>`
                + '</div>';
        }
        /** A target's name as the desktop card shows it, a brace block marked by one pair of its brackets. */
        const nameOf = (t) => { const inner = String(t.innerText || '').trim(); return t.type === 'brace' ? (t.braceKind === 'bracket' ? `[${inner}]` : `{${inner}}`) : inner; };

        function rowHtml(fid, s, t, i) {
            const name = esc(nameOf(t));
            const part = isPart(s, i);
            const wt = s.on ? `<span class="wds-rack-wt wm-seg"${part ? '' : ' aria-hidden="true"'}></span>` : '';
            const tail = part
                ? `${tool('snap', 'Suggested value', 'fas fa-bullseye')}${s.dist ? '<span aria-hidden="true"></span>' : tool('lock', 'Lock', 'fas fa-lock', ` aria-pressed="${locked(s, i) ? 'true' : 'false'}"`)}`
                : `${tool('snap', 'Suggested value', 'fas fa-bullseye')}<span class="wds-rack-cell"><button type="button" class="wm-valuepop-default" aria-label="${name}: Default" title="Default"></button></span>`;
            return `<div class="wds-wt-row wds-rack-row${part ? ' is-part' : ''}${locked(s, i) ? ' is-locked' : ''}" data-f="${esc(fid)}" data-k="${i}"><button type="button" class="wds-wt-name wds-rack-name" aria-haspopup="menu">${name}</button>${wt}<button type="button" class="wds-wt-lcd wm-lcd" aria-label="${name}: ${part ? (s.delta ? 'weight' : s.dist ? 'importance' : 'share') : 'weight'}"></button><span class="wds-rack-jog"></span>${tail}</div>`;
        }
        function plainHtml(s, p) {
            return `<div class="wds-wt-row wds-rack-plain"><span class="wds-wt-name">${esc(p.innerText)}</span>${s.on ? '<span></span>' : ''}<span class="wds-wt-lcd wm-lcd"></span></div>`;
        }

        function draw(el) {
            pageEl = el;
            if (!api.M || typeof api.M.rackReady !== 'function' || !api.M.rackReady()) { el.innerHTML = '<p class="wds-none">The Weight Rack is not ready yet.</p>'; shape = ''; return; }
            const data = fields().map((fid) => ({ fid, v: look(fid), s: state(fid) })).filter((f) => f.v.T.length);
            const next = JSON.stringify(data.map(({ fid, v, s }) => [fid, api.fieldName(fid), s.on, s.delta, s.dist, v.T.map((t, i) => [t.legacy, isPart(s, i), locked(s, i)]), v.P.map((p) => p.innerText), s.on && !s.T.some((t) => X().eligible(t.weight))]));
            const list = el.querySelector('.wds-rack-list');
            if (next !== shape || !list) {
                shape = next;
                rows = {};
                if (selected && !data.some((f) => f.fid === selected.fid && f.v.T[selected.k])) selected = null;
                el.innerHTML = `<div class="wm-form wds-rack-list">${data.length ? data.map(({ fid, v, s }) => {
                    const items = v.T.map((t, i) => ({ at: t.start, html: rowHtml(fid, s, t, i) })).concat(v.P.map((p) => ({ at: p.start, html: plainHtml(s, p) }))).sort((a, b) => a.at - b.at);
                    return `<div class="wds-rack-field${s.on ? ' is-norm' : ''}" data-f="${esc(fid)}">${headHtml(fid, s)}${barHtml(s)}${items.map((it) => it.html).join('')}</div>`;
                }).join('') : '<p class="wds-none">No emphasis groups in this prompt.</p>'}</div>`;
                el.querySelectorAll('.wds-rack-plain > .wds-wt-lcd').forEach((lcd) => api.ui.segText(lcd, f2(1), { signed: true }));
                data.forEach(({ fid, s }) => wireField(el, fid, s));
            }
            data.forEach(({ fid }) => update(fid));
            markSelected(el);
        }

        function wireField(el, fid, s) {
            const box = el.querySelector(`.wds-rack-field[data-f="${CSS.escape(fid)}"]`);
            if (!box) return;
            box.querySelectorAll('.wds-rack-head [data-act], .wds-rack-bar [data-act]').forEach((b) => b.addEventListener('click', (e) => barAction(fid, b.dataset.act, e.currentTarget)));
            const x = X();
            box.querySelectorAll('.wds-rack-row').forEach((row) => {
                const i = Number(row.dataset.k);
                const t = s.T[i];
                const key = rowKey(fid, i);
                const part = isPart(s, i);
                const r = rows[key] = { lcd: row.querySelector('.wds-wt-lcd'), wt: row.querySelector('.wds-rack-wt'), snap: row.querySelector('[data-act="snap"]'), lock: row.querySelector('[data-act="lock"]'), jog: null, weight: t.weight };
                const host = row.querySelector('.wds-rack-jog');
                if (part) {
                    const delta = s.delta;
                    r.jog = api.ui.jogWheel(host, delta
                        ? { label: `${nameOf(t)} weight`, value: displayWeights(s)[i], min: s.min, max: s.max, step: 0.01, fineStep: 0.001, stepPx: 18, zeroStop: 0, disabled: locked(s, i), onChange: (v) => { busy[key] = Date.now() + 900; changeWeightP(s, i, v); persist(fid); update(fid); } }
                        : { label: `${nameOf(t)} ${s.dist ? 'importance' : 'share'}`, value: s.dist ? impOf(s, i) : (s.shares[i] || 0), min: 0, max: 100, step: 1, fineStep: 0.1, stepPx: 18, zeroStop: 0, disabled: locked(s, i), onChange: (v) => { busy[key] = Date.now() + 900; changeShareP(s, i, v); persist(fid); update(fid); } });
                    r.lcd.addEventListener('click', () => { if (!locked(s, i)) padNorm(fid, i); });
                    if (r.lock) r.lock.addEventListener('click', () => { const c = s.cards[i] || card0(); s.cards[i] = Object.assign({}, c, { locked: !c.locked }); refreshSug(fid, s); persist(fid); api.paint(); });
                } else {
                    const put = (w) => { r.weight = w; api.ui.segText(r.lcd, f2(w), { signed: true }); setWeight(fid, i, w); };
                    // a brace block steps its NovelAI levels (1.05^n through 1 to the brackets)
                    r.jog = t.type === 'brace'
                        ? api.ui.jogWheel(host, { label: `${nameOf(t)} weight`, stepPx: 18, zeroStop: 0, onStep: (dir) => put(x.stepBrace(r.weight, dir)) })
                        : api.ui.jogWheel(host, { label: `${nameOf(t)} weight`, value: t.weight, min: JOG.min, max: JOG.max, step: JOG.step, fineStep: JOG.fineStep, stepPx: 18, onChange: put });
                    const def = row.querySelector('.wm-valuepop-default');
                    if (def) def.addEventListener('click', () => { if (r.jog && t.type !== 'brace') r.jog.set(JOG.def); put(JOG.def); });
                    r.lcd.addEventListener('click', () => padWeight(fid, i, r.weight));
                }
                host.replaceWith(...host.childNodes);
                if (r.snap) r.snap.addEventListener('click', () => snapTo(fid, s, i));
                row.querySelector('.wds-rack-name').addEventListener('click', (e) => {
                    selected = { fid, k: i };
                    markSelected(el);
                    api.sh.dropdown(e.currentTarget, groupRows(selected), 'left');
                });
            });
        }

        function barAction(fid, act, btn) {
            const s = state(fid);
            if (act === 'normalize') { if (s.on) disable(fid, s); else enable(fid, s); persist(fid); api.paint(); return; }
            if (act === 'rebalance') { rebalanceDirect(fid, s); return; }
            if (act === 'min' || act === 'max') { rangePop(fid, act, btn); return; }
            if (act === 'delta') setDelta(s, !s.delta);
            else if (act === 'dist') setDist(s, !s.dist);
            else if (act === 'pull') pullBand(s);
            else if (act === 'autoband') { if (s.autoBand) return; autoBand(fid, s); } else if (act === 'rescale') { if (s.autoRescale) return; attentionRescale(fid, s); } else if (act === 'apply') { applyNormalize(fid, s); return; }
            persist(fid);
            api.paint();
            update(fid);
        }

        /** A field's figures from its state (no rebuild: a wheel under the finger stays put). */
        function update(fid) {
            const s = NS[fid];
            const box = pageEl && pageEl.querySelector(`.wds-rack-field[data-f="${CSS.escape(fid)}"]`);
            if (!s || !box) return;
            const ws = s.on ? displayWeights(s) : null;
            box.querySelectorAll('.wds-rack-row').forEach((row) => {
                const i = Number(row.dataset.k);
                const key = rowKey(fid, i);
                const r = rows[key];
                const t = s.T[i];
                if (!r || !t) return;
                const held = (busy[key] || 0) > Date.now() || (pending[fid] && pending[fid].has(i));
                if (isPart(s, i)) {
                    const v = s.delta ? ws[i] : (s.dist ? impOf(s, i) : (s.shares[i] || 0));
                    api.ui.segText(r.lcd, s.delta ? f2(v) : f1(v));
                    if (r.wt) api.ui.segText(r.wt, s.delta ? f1(s.shares[i] || 0) : f2(ws[i]));
                    if (!held && r.jog) r.jog.set(v);
                } else {
                    if (r.wt) r.wt.textContent = '';
                    if (!held) {
                        if (r.weight !== t.weight || !r.lcd.textContent) { r.weight = t.weight; if (r.jog) r.jog.set(t.weight); }
                        api.ui.segText(r.lcd, f2(r.weight), { signed: true });
                    }
                }
                if (r.snap) {
                    const info = snapInfo(s, i);
                    r.snap.classList.toggle('is-off', !info);
                    r.snap.title = info ? (info.kind === 'under' ? 'Raise to suggested value' : 'Lower to suggested value') : '';
                }
            });
            const minB = box.querySelector('.wds-rack-bar [data-act="min"]');
            const maxB = box.querySelector('.wds-rack-bar [data-act="max"]');
            box.querySelectorAll('.wds-rack-bar [aria-pressed]').forEach((b) => {
                const on = { delta: s.delta, dist: s.dist, autoband: s.autoBand, rescale: s.autoRescale }[b.dataset.act];
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            if (minB) { api.ui.segText(minB, f2(s.min)); minB.disabled = s.autoBand; }
            if (maxB) { api.ui.segText(maxB, f2(s.max)); maxB.disabled = s.autoBand; }
        }

        function markSelected(el) {
            el.querySelectorAll('.wds-rack-row').forEach((row) => row.classList.toggle('is-selected', !!selected && row.dataset.f === selected.fid && Number(row.dataset.k) === selected.k));
        }

        /** The page's Menu: the selected row's tools, each normalized field's rows, Convert {}/[]. */
        function rackMenu() {
            const out = [];
            if (selected) out.push(...groupRows(selected));
            const norm = fields().filter((fid) => NS[fid] && NS[fid].on && look(fid).T.length).map((fid) => ({ label: api.fieldName(fid), submenu: () => normRows(fid) }));
            if (norm.length) { if (out.length) out.push('-'); out.push(...norm); }
            const conv = convertRows();
            if (conv.length) { if (out.length) out.push('-'); out.push(...conv); }
            // nothing picked and nothing to set: the row tools, greyed (a tap on a row picks it)
            return out.length ? out : groupRows(null);
        }

        reg.view('rack', {
            title: 'Weight Rack',
            draw,
            menu: rackMenu
        });

        const open = () => { selected = null; api.openView('rack'); };
        reg.menu('prompt', () => [{ label: 'Weight Rack', action: open }, ...convertRows()]);

        // ---- the editor's toolbox: Split Emphasis and Convert {}/[] on the editor's own text (Undo
        // takes them back), the Weight Rack on its field

        function edReplace(ta, from, to, text) {
            ta.focus();
            ta.setSelectionRange(from, to);
            document.execCommand('insertText', false, text);
        }
        // the selection as it was when the toolbox opened (a tap on its menu can take it away)
        function splitInEditor(from, to) {
            const ta = api.edArea();
            if (!ta) return;
            const r = api.M.rackSplitAround(ta.value, from, to);
            if (r) edReplace(ta, r.from, r.to, r.text);
        }
        function convertInEditor() {
            const ta = api.edArea();
            if (!ta) return;
            api.M.rackBraceSpans(ta.value).forEach((sp) => edReplace(ta, sp.start, sp.end, sp.text));
        }

        // from the editor's toolbox: the editor keeps its text to itself until Done, so what it holds
        // goes to Studio first (the rack reads Studio), and once the rack steps back to it the
        // editor loads the field again with the rack's weights in it
        let fromEditor = false;
        reg.menu('toolbox', () => {
            const ta = api.edArea();
            const fid = api.edField();
            return [
                { label: 'Split Emphasis', disabled: !ta || ta.selectionStart === ta.selectionEnd, action: ((a, b) => () => splitInEditor(a, b))(ta && ta.selectionStart, ta && ta.selectionEnd) },
                { label: 'Convert {}/[]', disabled: !ta || !api.M.rackBraceSpans(ta.value).length, action: convertInEditor },
                '-',
                {
                    label: 'Weight Rack',
                    action: () => {
                        const sent = ta && fid && ta.value !== api.fieldValue(fid) ? api.fieldSet(fid, ta.value) : null;
                        Promise.resolve(sent).then(() => { api.refresh(); fromEditor = !!fid; open(); });
                    }
                }
            ];
        });
        reg.hook('paint', (v) => {
            if (!fromEditor || v === 'x:rack') return;
            fromEditor = false;
            if (v !== 'editor') return;
            Promise.all(Object.keys(pending).map(flush).concat(Object.values(chains))).then(() => {
                if (api.view() !== 'editor') return;
                api.refresh();
                api.edReload();
            });
        });
    });
})();
