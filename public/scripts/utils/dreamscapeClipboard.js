/**
 * DreamScape clipboard adapter – routes read/write through AndroidClipboard when
 * the native WebView bridge is present, otherwise uses navigator.clipboard and
 * legacy fallbacks.
 */

const DREAMSCAPE_CLIPBOARD_READ_TIMEOUT_MS = 30000;

let _androidClipboardReadSeq = 0;
const _androidClipboardPendingReads = {};
let _androidClipboardOnReadInstalled = false;

function isAndroidClipboardBridgeActive() {
    return typeof AndroidClipboard !== 'undefined'
        && typeof AndroidClipboard.read === 'function'
        && typeof AndroidClipboard.write === 'function';
}

function isClipboardReadAvailable() {
    if (isAndroidClipboardBridgeActive()) return true;
    return !!(navigator.clipboard && (navigator.clipboard.readText || navigator.clipboard.read));
}

function isClipboardWriteAvailable() {
    if (isAndroidClipboardBridgeActive()) return true;
    return !!(navigator.clipboard && (navigator.clipboard.writeText || navigator.clipboard.write));
}

function clipboardHasContent() {
    if (isAndroidClipboardBridgeActive() && typeof AndroidClipboard.hasContent === 'function') {
        try {
            return !!AndroidClipboard.hasContent();
        } catch (error) {
            console.warn('📱 AndroidClipboard.hasContent failed:', error);
            return false;
        }
    }
    return isClipboardReadAvailable();
}

function _installAndroidClipboardOnRead() {
    if (_androidClipboardOnReadInstalled || !isAndroidClipboardBridgeActive()) return;
    _androidClipboardOnReadInstalled = true;
    AndroidClipboard.onRead = function (requestId, jsonText) {
        const pending = _androidClipboardPendingReads[requestId];
        if (!pending) return;
        clearTimeout(pending.timeoutId);
        delete _androidClipboardPendingReads[requestId];
        try {
            const data = JSON.parse(jsonText);
            if (!data || data.ok === false) {
                pending.reject(new Error((data && data.error) || 'Clipboard read failed'));
                return;
            }
            pending.resolve(_normalizeAndroidReadResult(data));
        } catch (error) {
            pending.reject(error);
        }
    };
}

function _stripHtmlToText(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
}

function _base64ToBlob(base64, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            const comma = String(dataUrl).indexOf(',');
            resolve(comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl));
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
    });
}

function _stripDataUrlBase64(value) {
    if (!value) return '';
    const match = String(value).match(/^data:[^;]+;base64,(.+)$/);
    return match ? match[1] : String(value);
}

function _inferAndroidItemKind(item) {
    if (item.kind) return item.kind;
    if (item.text != null || item.html != null) return 'text';
    if (item.base64 && item.mime && String(item.mime).startsWith('image/')) return 'image';
    if (item.base64) return 'file';
    return 'unknown';
}

function _normalizeAndroidItem(item) {
    const kind = _inferAndroidItemKind(item);
    const normalized = {
        kind,
        mime: item.mime,
        error: item.error,
        uri: item.uri
    };

    if (kind === 'text') {
        normalized.text = item.text != null ? String(item.text) : _stripHtmlToText(item.html);
        normalized.html = item.html;
        return normalized;
    }

    if (kind === 'image' || kind === 'file') {
        normalized.text = item.text;
        if (item.base64) {
            const mime = item.mime || (kind === 'image' ? 'image/png' : 'application/octet-stream');
            normalized.blob = _base64ToBlob(item.base64, mime);
            if (item.name) {
                normalized.file = new File([normalized.blob], item.name, { type: mime });
            }
        } else if (item.dataUrl && kind === 'image') {
            const mimeMatch = String(item.dataUrl).match(/^data:([^;]+);base64,/);
            const mime = item.mime || (mimeMatch ? mimeMatch[1] : 'image/png');
            const base64 = _stripDataUrlBase64(item.dataUrl);
            normalized.blob = _base64ToBlob(base64, mime);
            if (item.name) {
                normalized.file = new File([normalized.blob], item.name, { type: mime });
            }
        }
        return normalized;
    }

    return normalized;
}

function _normalizeAndroidReadResult(data) {
    const items = Array.isArray(data.items) ? data.items.map(_normalizeAndroidItem) : [];
    return {
        empty: !!data.empty || items.length === 0,
        label: data.label,
        mimeTypes: data.mimeTypes,
        items
    };
}

function _readClipboardAndroid() {
    _installAndroidClipboardOnRead();
    return new Promise((resolve, reject) => {
        const requestId = ++_androidClipboardReadSeq;
        const timeoutId = setTimeout(() => {
            if (!_androidClipboardPendingReads[requestId]) return;
            delete _androidClipboardPendingReads[requestId];
            reject(new Error('Clipboard read timed out'));
        }, DREAMSCAPE_CLIPBOARD_READ_TIMEOUT_MS);

        _androidClipboardPendingReads[requestId] = { resolve, reject, timeoutId };

        try {
            AndroidClipboard.read(requestId);
        } catch (error) {
            clearTimeout(timeoutId);
            delete _androidClipboardPendingReads[requestId];
            reject(error);
        }
    });
}

async function _readClipboardWeb() {
    const items = [];
    let empty = true;

    if (navigator.clipboard && navigator.clipboard.read) {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const clipItem of clipboardItems) {
                for (const type of clipItem.types) {
                    if (type.startsWith('image/')) {
                        const blob = await clipItem.getType(type);
                        const ext = type.split('/')[1] || 'png';
                        const file = new File([blob], `clipboard-image.${ext}`, { type });
                        items.push({ kind: 'image', mime: type, blob, file });
                        empty = false;
                    }
                }
            }
        } catch (error) {
            console.warn('Clipboard.read() failed, falling back to text:', error);
        }
    }

    if (navigator.clipboard && navigator.clipboard.readText) {
        try {
            const text = await navigator.clipboard.readText();
            if (text != null && String(text).length > 0) {
                items.push({ kind: 'text', text: String(text) });
                empty = false;
            }
        } catch (error) {
            if (!items.length) throw error;
        }
    }

    return { empty, items };
}

function readClipboard() {
    if (isAndroidClipboardBridgeActive()) {
        return _readClipboardAndroid();
    }
    return _readClipboardWeb();
}

function getPrimaryTextFromClipboardResult(result) {
    if (!result || !Array.isArray(result.items)) return '';
    const textItem = result.items.find((item) => item.kind === 'text' && item.text);
    if (textItem) return textItem.text;
    const withText = result.items.find((item) => item.text);
    return withText ? withText.text : '';
}

function getPrimaryImageFileFromClipboardResult(result) {
    if (!result || !Array.isArray(result.items)) return null;
    const imageItem = result.items.find((item) => item.kind === 'image' && (item.file || item.blob));
    if (!imageItem) return null;
    if (imageItem.file) return imageItem.file;
    const mime = imageItem.mime || imageItem.blob.type || 'image/png';
    const ext = mime.split('/')[1] || 'png';
    return new File([imageItem.blob], `clipboard-image.${ext}`, { type: mime });
}

async function readClipboardText() {
    const result = await readClipboard();
    if (result.empty) return '';
    return getPrimaryTextFromClipboardResult(result);
}

async function _prepareAndroidWritePayload(payload) {
    if (payload == null) {
        return { items: [] };
    }

    if (payload.blob) {
        const mime = payload.blob.type || 'application/octet-stream';
        const kind = mime.startsWith('image/') ? 'image' : 'file';
        const base64 = await _blobToBase64(payload.blob);
        const item = { kind, mime, base64 };
        if (payload.name) item.name = payload.name;
        if (payload.label) {
            return { label: payload.label, items: [item] };
        }
        return { items: [item] };
    }

    if (payload.text != null && !payload.items) {
        const out = { text: String(payload.text) };
        if (payload.html) out.html = payload.html;
        if (payload.label) out.label = payload.label;
        return out;
    }

    const items = [];
    const sourceItems = Array.isArray(payload.items) ? payload.items : [];
    for (const item of sourceItems) {
        if (item.blob) {
            const mime = item.mime || item.blob.type || 'application/octet-stream';
            const kind = item.kind || (mime.startsWith('image/') ? 'image' : 'file');
            items.push({
                kind,
                mime,
                name: item.name,
                base64: await _blobToBase64(item.blob)
            });
            continue;
        }
        const normalized = { ...item };
        if (normalized.base64) {
            normalized.base64 = _stripDataUrlBase64(normalized.base64);
        }
        if (!normalized.kind) {
            if (normalized.text != null || normalized.html != null) normalized.kind = 'text';
            else if (normalized.base64 && normalized.mime && String(normalized.mime).startsWith('image/')) normalized.kind = 'image';
            else if (normalized.base64) normalized.kind = 'file';
        }
        items.push(normalized);
    }

    const out = { items };
    if (payload.label) out.label = payload.label;
    return out;
}

async function writeClipboard(payload) {
    if (isAndroidClipboardBridgeActive()) {
        _installAndroidClipboardOnRead();
        const writePayload = await _prepareAndroidWritePayload(payload);
        let resultJson;
        try {
            resultJson = AndroidClipboard.write(JSON.stringify(writePayload));
        } catch (error) {
            console.warn('📱 AndroidClipboard.write failed:', error);
            throw error;
        }
        let result;
        try {
            result = JSON.parse(resultJson);
        } catch (error) {
            console.warn('📱 AndroidClipboard.write returned invalid JSON:', resultJson);
            throw new Error('Clipboard write returned invalid response');
        }
        if (!result || result.ok === false) {
            throw new Error((result && result.error) || 'Clipboard write failed');
        }
        return;
    }

    if (payload && payload.blob) {
        if (!navigator.clipboard || !navigator.clipboard.write) {
            throw new Error('Clipboard API not available');
        }
        const type = payload.blob.type || 'application/octet-stream';
        await navigator.clipboard.write([new ClipboardItem({ [type]: payload.blob })]);
        return;
    }

    if (payload && payload.text != null && !payload.items) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(String(payload.text));
            return;
        }
        _fallbackCopyText(String(payload.text));
        return;
    }

    if (payload && Array.isArray(payload.items)) {
        const blobs = payload.items.filter((item) => item.blob);
        if (blobs.length && navigator.clipboard && navigator.clipboard.write) {
            const clipItems = {};
            for (const item of blobs) {
                const type = item.blob.type || item.mime || 'application/octet-stream';
                clipItems[type] = item.blob;
            }
            await navigator.clipboard.write([new ClipboardItem(clipItems)]);
            return;
        }
        const textItem = payload.items.find((item) => item.text != null);
        if (textItem) {
            await writeClipboard({ text: textItem.text, html: textItem.html, label: payload.label });
            return;
        }
    }

    throw new Error('Nothing to write to clipboard');
}

function _fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
    } finally {
        document.body.removeChild(textarea);
    }
}

async function copyTextToClipboard(text, options) {
    const opts = options || {};
    await writeClipboard({
        text: text == null ? '' : String(text),
        html: opts.html,
        label: opts.label
    });
}

async function copyBlobToClipboard(blob, options) {
    const opts = options || {};
    await writeClipboard({
        blob,
        name: opts.name,
        label: opts.label
    });
}

function formatClipboardBlobSize(blob) {
    const sizeInBytes = blob.size;
    if (sizeInBytes < 1024 * 1024) {
        return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    }
    return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
}

_installAndroidClipboardOnRead();
