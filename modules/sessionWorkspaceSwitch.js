'use strict';

const crypto = require('crypto');

// The card counts down for this long. A timeout is a decline.
const SWITCH_WAIT_MS = 90 * 1000;

const pending = new Map();

function switchAnswer(id, status) {
    const name = status === 'accepted' ? 'accepted' : (status === 'timeout' ? 'timeout' : 'declined');
    return {
        id,
        status: name,
        accepted: name === 'accepted',
        declined: name !== 'accepted',
        timedOut: name === 'timeout'
    };
}

function settleWorkspaceSwitch(id, answer) {
    const row = pending.get(id);
    if (!row || row.settled) return false;
    row.settled = true;
    clearTimeout(row.timer);
    row.answer = answer;
    if (row.waiter) {
        pending.delete(id);
        row.waiter(answer);
    }
    return true;
}

function beginWorkspaceSwitch(spec, waitMs) {
    const id = crypto.randomBytes(8).toString('hex');
    const timeoutMs = Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : SWITCH_WAIT_MS;
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => {
        settleWorkspaceSwitch(id, switchAnswer(id, 'timeout'));
    }, timeoutMs);
    pending.set(id, { timer, waiter: null, answer: null, settled: false, deadline, timeoutMs });
    const src = spec && typeof spec === 'object' ? spec : {};
    return {
        id,
        deadline,
        timeoutMs,
        workspaceId: src.workspaceId || '',
        workspaceName: src.workspaceName || src.workspaceId || '',
        reason: src.reason || ''
    };
}

function awaitWorkspaceSwitch(id) {
    const key = String(id || '');
    const row = pending.get(key);
    if (!row) {
        return Promise.resolve(switchAnswer(key, 'timeout'));
    }
    if (row.answer) {
        pending.delete(key);
        return Promise.resolve(row.answer);
    }
    return new Promise((resolve) => {
        row.waiter = resolve;
    });
}

function submitWorkspaceSwitch(message) {
    const src = message && typeof message === 'object' ? message : {};
    const id = String(src.switchId || src.id || '').trim();
    if (!id || !pending.has(id)) return false;
    const status = src.status === 'accepted' || src.accepted === true
        ? 'accepted'
        : (src.status === 'timeout' || src.timedOut === true ? 'timeout' : 'declined');
    return settleWorkspaceSwitch(id, switchAnswer(id, status));
}

function cancelWorkspaceSwitch(id) {
    const row = pending.get(String(id || ''));
    if (!row) return;
    row.settled = true;
    clearTimeout(row.timer);
    pending.delete(String(id || ''));
}

function resetWorkspaceSwitchForTests() {
    for (const [id, row] of pending) {
        row.settled = true;
        clearTimeout(row.timer);
        pending.delete(id);
    }
}

module.exports = {
    SWITCH_WAIT_MS,
    beginWorkspaceSwitch,
    awaitWorkspaceSwitch,
    submitWorkspaceSwitch,
    cancelWorkspaceSwitch,
    resetWorkspaceSwitchForTests
};
