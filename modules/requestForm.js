'use strict';

const crypto = require('crypto');

const FORM_TYPES = new Set(['text', 'textmulti', 'prompt', 'bool', 'select', 'int', 'number']);
const MAX_FIELDS = 12;
const WAIT_MS = 8 * 60 * 1000;
const pending = new Map();

function fieldId(field, index) {
    const raw = String((field && (field.id || field.key)) || '').trim();
    if (raw) return raw.slice(0, 64);
    const label = String((field && field.label) || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return (label || `field_${index + 1}`).slice(0, 64);
}

function normalizeOption(option) {
    if (typeof option === 'string' || typeof option === 'number') {
        const value = String(option);
        return { value, label: value };
    }
    if (!option || typeof option !== 'object') return null;
    const value = option.value != null ? String(option.value) : String(option.label || '');
    if (!value) return null;
    return { value, label: option.label != null ? String(option.label) : value };
}

function normalizeField(field, index) {
    if (!field || typeof field !== 'object') return null;
    const type = String(field.type || 'text').toLowerCase();
    if (!FORM_TYPES.has(type)) return null;
    const label = String(field.label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label) return null;
    const data = field.data && typeof field.data === 'object' && !Array.isArray(field.data) ? field.data : {};
    const options = type === 'select'
        ? (Array.isArray(data.options) ? data.options : []).map(normalizeOption).filter(Boolean).slice(0, 30)
        : [];
    return {
        id: fieldId(field, index),
        label,
        type,
        sub: String(field.sub || field.subText || field.hint || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        data: {
            placeholder: data.placeholder ? String(data.placeholder).slice(0, 120) : '',
            default: data.default != null ? data.default : null,
            required: data.required === true,
            min: Number.isFinite(Number(data.min)) ? Number(data.min) : null,
            max: Number.isFinite(Number(data.max)) ? Number(data.max) : null,
            step: Number.isFinite(Number(data.step)) ? Number(data.step) : null,
            options
        }
    };
}

function normalizeRequestForm(input) {
    const src = input && typeof input === 'object' ? input : {};
    const fields = (Array.isArray(src.fields) ? src.fields : []).map(normalizeField).filter(Boolean).slice(0, MAX_FIELDS);
    return {
        title: String(src.title || 'Form').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Form',
        submitLabel: String(src.submitLabel || src.submit || 'Send').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Send',
        fields
    };
}

function broadcastForm(globalResources, packet) {
    let wsServer = null;
    try { wsServer = globalResources && globalResources.getWebSocketServer(); } catch (_) { wsServer = null; }
    if (!wsServer || typeof wsServer.broadcast !== 'function') return false;
    if (wsServer.clients && wsServer.clients.size === 0) return false;
    wsServer.broadcast({
        type: 'request_form',
        data: packet,
        timestamp: new Date().toISOString()
    });
    return true;
}

function askRequestForm(globalResources, spec) {
    const id = crypto.randomBytes(8).toString('hex');
    const sent = broadcastForm(globalResources, Object.assign({ id }, spec));
    if (!sent) {
        const error = new Error('No client is connected to show the form');
        error.code = 'NOT_BOUND';
        return Promise.reject(error);
    }
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ id, cancelled: true, timedOut: true, values: null });
        }, WAIT_MS);
        pending.set(id, { resolve, timer });
    });
}

function submitRequestForm(message) {
    const id = String((message && (message.id || message.formId)) || '').trim();
    const row = id ? pending.get(id) : null;
    if (!row) return false;
    clearTimeout(row.timer);
    pending.delete(id);
    const values = message && message.values && typeof message.values === 'object' ? message.values : null;
    row.resolve({
        id,
        cancelled: message && message.cancelled === true,
        timedOut: false,
        values
    });
    return true;
}

module.exports = {
    FORM_TYPES,
    normalizeRequestForm,
    askRequestForm,
    submitRequestForm
};
